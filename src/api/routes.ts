/**
 * Hono API Routes for RWOS
 *
 * Job submission, status queries, and admin endpoints.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Effect } from "effect";
import { makeRedisLayer, type RedisEnv } from "../redis/client";
import { enqueueJob, getJobStatus, getPendingCount, getActiveJobs } from "../orchestration/job-manager";
import { getAdmissionStats } from "../orchestration/admission";
import { maybeSpawnWorker, type SpawnConfig } from "../orchestration/spawner";

// =============================================================================
// Request Schemas
// =============================================================================

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
	 * POST /jobs - Submit a new transcoding job
	 */
	app.post("/jobs", zValidator("json", submitJobSchema), async (c) => {
		const body = c.req.valid("json");
		const jobId = body.jobId || crypto.randomUUID();

		const redisLayer = makeRedisLayer(c.env);

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				// Enqueue job
				const job = yield* enqueueJob({
					jobId,
					inputUrl: body.inputUrl,
					outputUrl: body.outputUrl,
					preset: body.preset,
					webhookUrl: `${c.env.WEBHOOK_BASE_URL}/webhooks/job-complete`,
					outputQualities: body.outputQualities,
					r2Config: body.r2Config,
				});

				// Try to spawn a worker if capacity available
				const spawnConfig: SpawnConfig = {
					flyApiToken: c.env.FLY_API_TOKEN,
					flyAppName: c.env.FLY_APP_NAME,
					flyRegion: c.env.FLY_REGION,
					redisUrl: c.env.UPSTASH_REDIS_REST_URL,
					redisToken: c.env.UPSTASH_REDIS_REST_TOKEN,
					webhookBaseUrl: c.env.WEBHOOK_BASE_URL,
				};

				const spawned = yield* maybeSpawnWorker(spawnConfig).pipe(
					Effect.catchAll(() => Effect.succeed(null))
				);

				return { job, spawned };
			}).pipe(Effect.provide(redisLayer))
		);

		return c.json({
			jobId: result.job.jobId,
			status: result.job.status,
			machineId: result.spawned?.machineId || null,
			queuedAt: result.job.queuedAt,
		}, 201);
	});

	/**
	 * GET /jobs/:jobId - Get job status
	 */
	app.get("/jobs/:jobId", async (c) => {
		const jobId = c.req.param("jobId");
		const redisLayer = makeRedisLayer(c.env);

		const job = await Effect.runPromise(
			getJobStatus(jobId).pipe(Effect.provide(redisLayer))
		);

		if (!job) {
			return c.json({ error: "Job not found" }, 404);
		}

		return c.json(job);
	});

	/**
	 * GET /stats - Get system stats
	 */
	app.get("/stats", async (c) => {
		const redisLayer = makeRedisLayer(c.env);

		const stats = await Effect.runPromise(
			Effect.gen(function* () {
				const admission = yield* getAdmissionStats();
				const pendingCount = yield* getPendingCount();
				const activeJobs = yield* getActiveJobs();

				return {
					machines: admission,
					pendingJobs: pendingCount,
					activeJobs: Object.keys(activeJobs).length,
					activeJobIds: Object.keys(activeJobs),
				};
			}).pipe(Effect.provide(redisLayer))
		);

		return c.json(stats);
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
		})
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

		// Log completion (can be extended to notify clients, update DB, etc.)
		console.log(`[Webhook] Job ${payload.jobId} ${payload.status}`, {
			outputs: payload.outputs.length,
			duration: payload.duration,
			error: payload.error,
		});

		return c.json({ received: true });
	});

	return app;
};

