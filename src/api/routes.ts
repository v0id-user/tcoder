/**
 * Hono API Routes for RWOS
 *
 * Job submission, upload URLs, status queries, and admin endpoints.
 */

import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { getAdmissionStats } from "../orchestration/admission";
import { type SpawnConfig, maybeSpawnWorker } from "../orchestration/spawner";
import { type R2Config, createR2Client, generateInputKey, generateUploadUrl } from "../r2/presigned";
import { type RedisEnv, makeRedisLayer } from "../redis/client";
import { type JobData, RWOS_CONFIG, RedisKeys, deserializeJobData, serializeJobData } from "../redis/schema";

// =============================================================================
// Request Schemas
// =============================================================================

const uploadRequestSchema = z.object({
	filename: z.string().min(1),
	contentType: z.string().optional().default("video/mp4"),
	preset: z.enum(["default", "web-optimized", "hls", "hls-adaptive"]).default("default"),
	outputQualities: z.array(z.string()).optional(),
});

const submitJobSchema = z.object({
	jobId: z.string().uuid().optional(),
	inputUrl: z.string().url(),
	outputUrl: z.string(),
	preset: z.enum(["default", "web-optimized", "hls", "hls-adaptive"]).default("default"),
	outputQualities: z.array(z.string()).optional(),
	r2Config: z
		.object({
			accountId: z.string(),
			accessKeyId: z.string(),
			secretAccessKey: z.string(),
			bucketName: z.string(),
			endpoint: z.string().optional(),
		})
		.optional(),
});

// =============================================================================
// Environment Types
// =============================================================================

type Env = RedisEnv & {
	// R2 bindings
	INPUT_BUCKET: R2Bucket;
	OUTPUT_BUCKET: R2Bucket;
	// R2 credentials for presigned URLs
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_INPUT_BUCKET_NAME: string;
	R2_OUTPUT_BUCKET_NAME: string;
	// Fly config
	FLY_API_TOKEN: string;
	FLY_APP_NAME: string;
	FLY_REGION: string;
	WEBHOOK_BASE_URL: string;
};

// =============================================================================
// Routes
// =============================================================================

export const createRoutes = () => {
	const app = new Hono<{ Bindings: Env }>();

	/**
	 * POST /upload - Request a presigned URL for uploading
	 *
	 * 1. Generate job ID
	 * 2. Create presigned PUT URL for R2
	 * 3. Store job with "uploading" status in Redis
	 * 4. Return upload URL and job ID to client
	 */
	app.post("/upload", zValidator("json", uploadRequestSchema), async (c) => {
		const body = c.req.valid("json");
		const jobId = crypto.randomUUID();

		// Create R2 client for presigned URL generation
		const r2Config: R2Config = {
			accountId: c.env.R2_ACCOUNT_ID,
			accessKeyId: c.env.R2_ACCESS_KEY_ID,
			secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
			bucketName: c.env.R2_INPUT_BUCKET_NAME,
		};

		const r2Client = createR2Client(r2Config);
		const inputKey = generateInputKey(jobId, body.filename);

		// Generate presigned upload URL
		const presigned = await generateUploadUrl(r2Client, r2Config.bucketName, inputKey, {
			expiresIn: RWOS_CONFIG.PRESIGNED_URL_EXPIRY_SECONDS,
			contentType: body.contentType,
		});

		// Store job with "uploading" status in Redis
		const redis = Redis.fromEnv(c.env);

		const jobData: JobData = {
			jobId,
			status: "uploading",
			inputKey,
			outputUrl: `outputs/${jobId}`,
			preset: body.preset,
			webhookUrl: `${c.env.WEBHOOK_BASE_URL}/webhooks/job-complete`,
			outputQualities: body.outputQualities,
			filename: body.filename,
			contentType: body.contentType,
			timestamps: {
				createdAt: Date.now(),
			},
			retries: 0,
		};

		await redis.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
		await redis.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);

		return c.json(
			{
				jobId,
				uploadUrl: presigned.uploadUrl,
				expiresAt: presigned.expiresAt,
				inputKey,
			},
			201,
		);
	});

	/**
	 * POST /jobs - Submit a new transcoding job (direct, without upload)
	 */
	app.post("/jobs", zValidator("json", submitJobSchema), async (c) => {
		const body = c.req.valid("json");
		const jobId = body.jobId || crypto.randomUUID();
		const redis = Redis.fromEnv(c.env);

		const now = Date.now();

		const jobData: JobData = {
			jobId,
			status: "pending",
			inputKey: "",
			inputUrl: body.inputUrl,
			outputUrl: body.outputUrl,
			preset: body.preset,
			webhookUrl: `${c.env.WEBHOOK_BASE_URL}/webhooks/job-complete`,
			outputQualities: body.outputQualities,
			timestamps: {
				createdAt: now,
				queuedAt: now,
			},
			retries: 0,
			r2Config: body.r2Config,
		};

		// Store job and enqueue
		const pipe = redis.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
		pipe.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
		pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
		await pipe.exec();

		// Try to spawn worker if capacity available
		const redisLayer = makeRedisLayer(c.env);

		const spawnConfig: SpawnConfig = {
			flyApiToken: c.env.FLY_API_TOKEN,
			flyAppName: c.env.FLY_APP_NAME,
			flyRegion: c.env.FLY_REGION,
			redisUrl: c.env.UPSTASH_REDIS_REST_URL,
			redisToken: c.env.UPSTASH_REDIS_REST_TOKEN,
			webhookBaseUrl: c.env.WEBHOOK_BASE_URL,
		};

		const spawned = await Effect.runPromise(
			maybeSpawnWorker(spawnConfig).pipe(
				Effect.catchAll(() => Effect.succeed(null)),
				Effect.provide(redisLayer),
			),
		);

		return c.json(
			{
				jobId,
				status: "pending",
				machineId: spawned?.machineId || null,
				queuedAt: now,
			},
			201,
		);
	});

	/**
	 * GET /jobs/:jobId - Get job status (polling endpoint)
	 */
	app.get("/jobs/:jobId", async (c) => {
		const jobId = c.req.param("jobId");
		const redis = Redis.fromEnv(c.env);

		const data = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));

		if (!data || Object.keys(data).length === 0) {
			return c.json({ error: "Job not found" }, 404);
		}

		const job = deserializeJobData(data);
		if (!job) {
			return c.json({ error: "Invalid job data" }, 500);
		}

		// Return structured response for polling
		return c.json({
			jobId: job.jobId,
			status: job.status,
			machineId: job.machineId,
			outputs: job.outputs,
			error: job.error,
			timestamps: job.timestamps,
			filename: job.filename,
			preset: job.preset,
		});
	});

	/**
	 * GET /stats - Get system stats
	 */
	app.get("/stats", async (c) => {
		const redisLayer = makeRedisLayer(c.env);
		const redis = Redis.fromEnv(c.env);

		const stats = await Effect.runPromise(
			Effect.gen(function* () {
				const admission = yield* getAdmissionStats();
				return admission;
			}).pipe(Effect.provide(redisLayer)),
		);

		// Get queue stats
		const pendingCount = await redis.zcard(RedisKeys.jobsPending);
		const activeJobs = await redis.hgetall<Record<string, string>>(RedisKeys.jobsActive);

		return c.json({
			machines: stats,
			pendingJobs: pendingCount,
			activeJobs: activeJobs ? Object.keys(activeJobs).length : 0,
			activeJobIds: activeJobs ? Object.keys(activeJobs) : [],
		});
	});

	return app;
};

// =============================================================================
// Webhook Routes
// =============================================================================

const webhookPayloadSchema = z.object({
	jobId: z.string(),
	status: z.enum(["completed", "failed"]),
	inputUrl: z.string(),
	outputs: z.array(
		z.object({
			quality: z.string(),
			url: z.string(),
			preset: z.string(),
		}),
	),
	error: z.string().optional(),
	duration: z.number().optional(),
});

export const createWebhookRoutes = () => {
	const app = new Hono<{ Bindings: Env }>();

	/**
	 * POST /webhooks/job-complete - Receive job completion notifications
	 */
	app.post("/webhooks/job-complete", zValidator("json", webhookPayloadSchema), async (c) => {
		const payload = c.req.valid("json");
		const redis = Redis.fromEnv(c.env);

		// Update job status in Redis
		const now = Date.now();
		const updates: Record<string, string> = {
			status: payload.status,
			completedAt: String(now),
		};

		if (payload.outputs.length > 0) {
			updates.outputs = JSON.stringify(
				payload.outputs.map((o) => ({
					quality: o.quality,
					url: o.url,
				})),
			);
		}

		if (payload.error) {
			updates.error = payload.error;
		}

		await redis.hset(RedisKeys.jobStatus(payload.jobId), updates);

		// Remove from active jobs
		await redis.hdel(RedisKeys.jobsActive, payload.jobId);

		console.log(`[Webhook] Job ${payload.jobId} ${payload.status}`, {
			outputs: payload.outputs.length,
			duration: payload.duration,
			error: payload.error,
		});

		return c.json({ received: true });
	});

	return app;
};
