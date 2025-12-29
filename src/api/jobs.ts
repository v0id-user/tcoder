import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { type SpawnConfig, maybeSpawnWorker } from "../orchestration/spawner";
import { makeRedisLayer } from "../redis/client";
import { type JobData, RWOS_CONFIG, RedisKeys, deserializeJobData, serializeJobData } from "../redis/schema";
import { extractJobIdFromKey } from "../r2/presigned";
import { isDevMode } from "../utils/dev-mode";
import { submitJobSchema } from "./schemas";
import type { Env } from "./types";

const buildJobRoutes = () => {
	/**
	 * POST /jobs - Submit a new transcoding job (direct, without upload)
	 */
	const app = new Hono<{ Bindings: Env }>()
		.post("/jobs", zValidator("json", submitJobSchema), async (c) => {
			const body = c.req.valid("json");
			const jobId = body.jobId || crypto.randomUUID();
			const now = Date.now();

			try {
				const redis = Redis.fromEnv(c.env);

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

				const pipe = redis.pipeline();
				pipe.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
				pipe.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
				pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
				await pipe.exec();

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
			} catch (error) {
				console.error("[Route] Redis error in /jobs:", error);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.get("/jobs/:jobId", zValidator("param", z.object({ jobId: z.string() })), async (c) => {
			const { jobId } = c.req.valid("param");
			try {
				const redis = Redis.fromEnv(c.env);

				const data = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));

				if (!data || Object.keys(data).length === 0) {
					return c.json({ error: "Job not found" }, 404);
				}

				const job = deserializeJobData(data);
				if (!job) {
					return c.json({ error: "Invalid job data" }, 500);
				}

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
			} catch (error) {
				console.error("[Route] Redis error in GET /jobs/:jobId:", error);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.post("/jobs/:jobId/trigger-r2-event", zValidator("param", z.object({ jobId: z.string() })), async (c) => {
			// Only allow in dev mode
			if (!isDevMode(c.env.FLY_API_TOKEN)) {
				return c.json({ error: "Not found" }, 404);
			}

			const { jobId } = c.req.valid("param");
			try {
				const redis = Redis.fromEnv(c.env);

				// Get existing job data
				const jobData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
				if (!jobData || Object.keys(jobData).length === 0) {
					return c.json({ error: "Job not found" }, 404);
				}

				const job = deserializeJobData(jobData);
				if (!job) {
					return c.json({ error: "Invalid job data" }, 500);
				}

				// Only process jobs in "uploading" status
				if (job.status !== "uploading") {
					return c.json({ error: `Job is in ${job.status} status, expected uploading` }, 400);
				}

				if (!job.inputKey) {
					return c.json({ error: "Job has no inputKey" }, 400);
				}

				// Simulate R2 event: update job to pending and enqueue
				const now = Date.now();
				const inputUrl = `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_INPUT_BUCKET_NAME}/${job.inputKey}`;

				const updates: Record<string, string> = {
					status: "pending",
					inputUrl,
					uploadedAt: String(now),
					queuedAt: String(now),
				};

				const pipe = redis.pipeline();
				pipe.hset(RedisKeys.jobStatus(jobId), updates);
				pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
				await pipe.exec();

				// Try to spawn a worker
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

				return c.json({
					success: true,
					jobId,
					status: "pending",
					machineId: spawned?.machineId || null,
					queuedAt: now,
				});
			} catch (error) {
				console.error("[Route] Redis error in POST /jobs/:jobId/trigger-r2-event:", error);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		});

	return app;
};

export const createJobRoutes = (): ReturnType<typeof buildJobRoutes> => {
	return buildJobRoutes();
};
