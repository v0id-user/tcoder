import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../../packages/logger";
import { type SpawnConfig, maybeSpawnWorker } from "../orchestration/spawner";
import { makeRedisLayer } from "../redis/client";
import { type JobData, type JobOutput, RWOS_CONFIG, RedisKeys, deserializeJobData, serializeJobData } from "../redis/schema";
import { submitJobSchema } from "./schemas";
import type { Env } from "./types";

/**
 * Transform R2 storage URL to public and CDN URLs.
 * Extracts the R2 key by removing the bucket name prefix from the path.
 *
 * Example:
 * Input:  https://{accountId}.r2.cloudflarestorage.com/tcoder-output/outputs/{jobId}
 * Output: https://pub-{id}.r2.dev/outputs/{jobId}
 */
const transformOutputUrl = (r2Url: string, env: Env): { url: string; cdnUrl?: string } => {
	// If public URL is not configured, return original URL
	if (!env.R2_PUBLIC_URL) {
		return { url: r2Url };
	}

	try {
		const urlObj = new URL(r2Url);

		// Only transform R2 storage URLs (r2.cloudflarestorage.com)
		// Skip if already a public URL or CDN URL
		if (!urlObj.hostname.includes("r2.cloudflarestorage.com")) {
			return { url: r2Url };
		}

		// Extract the path and remove the bucket name prefix
		// Example: /tcoder-output/outputs/792eabb3-3314-44d1-b698-796220bd1e6c
		// Should become: outputs/792eabb3-3314-44d1-b698-796220bd1e6c
		const pathParts = urlObj.pathname.split("/").filter(Boolean);

		// Remove the bucket name (first part) if it matches the output bucket name
		if (pathParts.length > 0 && pathParts[0] === env.R2_OUTPUT_BUCKET_NAME) {
			pathParts.shift();
		}

		const key = pathParts.join("/");

		// Build public URL (ensure no double slashes)
		const publicUrlBase = env.R2_PUBLIC_URL.replace(/\/$/, "");
		const publicUrl = `${publicUrlBase}/${key}`;

		// Build CDN URL if configured
		const cdnUrl = env.BUNNY_CDN_URL ? `${env.BUNNY_CDN_URL.replace(/\/$/, "")}/${key}` : undefined;

		return { url: publicUrl, ...(cdnUrl && { cdnUrl }) };
	} catch {
		// If URL parsing fails, return original URL
		return { url: r2Url };
	}
};

/**
 * Transform job outputs array, converting R2 URLs to public/CDN URLs.
 */
const transformOutputs = (outputs: JobOutput[] | undefined, env: Env): JobOutput[] | undefined => {
	if (!outputs || outputs.length === 0) {
		return outputs;
	}

	return outputs.map((output) => {
		const transformed = transformOutputUrl(output.url, env);
		return {
			...output,
			url: transformed.url,
			...(transformed.cdnUrl && { cdnUrl: transformed.cdnUrl }),
		};
	});
};

const buildJobRoutes = () => {
	/**
	 * POST /jobs - Submit a new transcoding job (direct, without upload)
	 */
	const app = new Hono<{ Bindings: Env }>()
		.post("/jobs", zValidator("json", submitJobSchema), async (c) => {
			const startTime = Date.now();
			const requestId = crypto.randomUUID();
			const loggerLayer = makeLoggerLayer({ component: "Jobs", logLevel: "info" });
			const effectLoggerLayer = makeEffectLoggerLayer("info");

			const body = c.req.valid("json");
			const jobId = body.jobId || crypto.randomUUID();
			const now = Date.now();

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("POST /jobs - Request received", {
						requestId,
						method: "POST",
						path: "/jobs",
						jobId,
						providedJobId: body.jobId || null,
						inputUrl: body.inputUrl,
						outputUrl: body.outputUrl,
						preset: body.preset,
						outputQualities: body.outputQualities,
						hasR2Config: !!body.r2Config,
						userAgent: c.req.header("user-agent"),
						ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

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

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Storing job in Redis and enqueueing", {
							requestId,
							jobId,
							status: jobData.status,
							ttl: RWOS_CONFIG.JOB_STATUS_TTL_SECONDS,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const pipe = redis.pipeline();
				pipe.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
				pipe.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
				pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
				await pipe.exec();

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job stored and enqueued successfully", {
							requestId,
							jobId,
							event: "job.enqueued",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const redisLayer = makeRedisLayer(c.env);

				const spawnConfig: SpawnConfig = {
					flyApiToken: c.env.FLY_API_TOKEN,
					flyAppName: c.env.FLY_APP_NAME,
					flyRegion: c.env.FLY_REGION,
					redisUrl: c.env.UPSTASH_REDIS_REST_URL,
					redisToken: c.env.UPSTASH_REDIS_REST_TOKEN,
					webhookBaseUrl: c.env.WEBHOOK_BASE_URL,
				};

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Attempting to spawn worker", {
							requestId,
							jobId,
							region: spawnConfig.flyRegion,
							event: "worker.spawn.attempt",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const spawned = await Effect.runPromise(
					maybeSpawnWorker(spawnConfig).pipe(
						Effect.catchAll((error) => {
							return Effect.gen(function* () {
								const logger = yield* LoggerService;
								yield* logger.warn("Worker spawn failed (non-fatal)", {
									requestId,
									jobId,
									error: error instanceof Error ? error.message : String(error),
								});
								return null;
							}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer));
						}),
						Effect.provide(redisLayer),
						Effect.provide(loggerLayer),
						Effect.provide(effectLoggerLayer),
					),
				);

				if (spawned?.machineId) {
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.info("Worker spawned successfully", {
								requestId,
								jobId,
								machineId: spawned.machineId,
								event: "worker.spawned",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
				}

				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("POST /jobs - Request completed", {
							requestId,
							jobId,
							statusCode: 201,
							durationMs: duration,
							machineId: spawned?.machineId || null,
							event: "request.completed",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
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
				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.error("POST /jobs - Redis error", error, {
							requestId,
							jobId,
							statusCode: 500,
							durationMs: duration,
							event: "request.failed",
							errorType: "redis_error",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.get("/jobs/:jobId", zValidator("param", z.object({ jobId: z.string() })), async (c) => {
			const startTime = Date.now();
			const requestId = crypto.randomUUID();
			const loggerLayer = makeLoggerLayer({ component: "Jobs", logLevel: "info" });
			const effectLoggerLayer = makeEffectLoggerLayer("info");

			const { jobId } = c.req.valid("param");

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("GET /jobs/:jobId - Request received", {
						requestId,
						method: "GET",
						path: `/jobs/${jobId}`,
						jobId,
						userAgent: c.req.header("user-agent"),
						ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			try {
				const redis = Redis.fromEnv(c.env);

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Fetching job from Redis", {
							requestId,
							jobId,
							key: RedisKeys.jobStatus(jobId),
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const data = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));

				if (!data || Object.keys(data).length === 0) {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.warn("GET /jobs/:jobId - Job not found", {
								requestId,
								jobId,
								statusCode: 404,
								durationMs: duration,
								event: "job.not_found",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: "Job not found" }, 404);
				}

				const job = deserializeJobData(data);
				if (!job) {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.error("GET /jobs/:jobId - Invalid job data", undefined, {
								requestId,
								jobId,
								statusCode: 500,
								durationMs: duration,
								event: "job.invalid_data",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: "Invalid job data" }, 500);
				}

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job retrieved successfully", {
							requestId,
							jobId,
							status: job.status,
							machineId: job.machineId || null,
							hasOutputs: !!job.outputs && job.outputs.length > 0,
							outputCount: job.outputs?.length || 0,
							hasError: !!job.error,
							event: "job.retrieved",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("GET /jobs/:jobId - Request completed", {
							requestId,
							jobId,
							statusCode: 200,
							durationMs: duration,
							event: "request.completed",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				// Transform output URLs to public/CDN URLs
				const transformedOutputs = transformOutputs(job.outputs, c.env);

				return c.json({
					jobId: job.jobId,
					status: job.status,
					machineId: job.machineId,
					outputs: transformedOutputs,
					error: job.error,
					timestamps: job.timestamps,
					filename: job.filename,
					preset: job.preset,
				});
			} catch (error) {
				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.error("GET /jobs/:jobId - Redis error", error, {
							requestId,
							jobId,
							statusCode: 500,
							durationMs: duration,
							event: "request.failed",
							errorType: "redis_error",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.post("/jobs/:jobId/trigger-r2-event", zValidator("param", z.object({ jobId: z.string() })), async (c) => {
			const startTime = Date.now();
			const requestId = crypto.randomUUID();
			const loggerLayer = makeLoggerLayer({ component: "Jobs", logLevel: "info" });
			const effectLoggerLayer = makeEffectLoggerLayer("info");

			const { jobId } = c.req.valid("param");

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("POST /jobs/:jobId/trigger-r2-event - Request received", {
						requestId,
						method: "POST",
						path: `/jobs/${jobId}/trigger-r2-event`,
						jobId,
						userAgent: c.req.header("user-agent"),
						ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
						event: "r2.event.trigger.manual",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			try {
				const redis = Redis.fromEnv(c.env);

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Fetching job from Redis", {
							requestId,
							jobId,
							key: RedisKeys.jobStatus(jobId),
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				// Get existing job data
				const jobData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
				if (!jobData || Object.keys(jobData).length === 0) {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.warn("POST /jobs/:jobId/trigger-r2-event - Job not found", {
								requestId,
								jobId,
								statusCode: 404,
								durationMs: duration,
								event: "job.not_found",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: "Job not found" }, 404);
				}

				const job = deserializeJobData(jobData);
				if (!job) {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.error("POST /jobs/:jobId/trigger-r2-event - Invalid job data", undefined, {
								requestId,
								jobId,
								statusCode: 500,
								durationMs: duration,
								event: "job.invalid_data",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: "Invalid job data" }, 500);
				}

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job retrieved, validating status", {
							requestId,
							jobId,
							currentStatus: job.status,
							hasInputKey: !!job.inputKey,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				// Only process jobs in "uploading" status
				if (job.status !== "uploading") {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.warn("POST /jobs/:jobId/trigger-r2-event - Invalid job status", {
								requestId,
								jobId,
								currentStatus: job.status,
								expectedStatus: "uploading",
								statusCode: 400,
								durationMs: duration,
								event: "job.invalid_status",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: `Job is in ${job.status} status, expected uploading` }, 400);
				}

				if (!job.inputKey) {
					const duration = Date.now() - startTime;
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.warn("POST /jobs/:jobId/trigger-r2-event - Missing inputKey", {
								requestId,
								jobId,
								statusCode: 400,
								durationMs: duration,
								event: "job.missing_input_key",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					return c.json({ error: "Job has no inputKey" }, 400);
				}

				// Simulate R2 event: update job to pending and enqueue
				const now = Date.now();
				const inputUrl = `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_INPUT_BUCKET_NAME}/${job.inputKey}`;

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Updating job status to pending and enqueueing", {
							requestId,
							jobId,
							inputKey: job.inputKey,
							inputUrl,
							event: "job.status.transition",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job updated and enqueued successfully", {
							requestId,
							jobId,
							event: "job.enqueued",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Attempting to spawn worker", {
							requestId,
							jobId,
							region: spawnConfig.flyRegion,
							event: "worker.spawn.attempt",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const spawned = await Effect.runPromise(
					maybeSpawnWorker(spawnConfig).pipe(
						Effect.catchAll((error) => {
							return Effect.gen(function* () {
								const logger = yield* LoggerService;
								yield* logger.warn("Worker spawn failed (non-fatal)", {
									requestId,
									jobId,
									error: error instanceof Error ? error.message : String(error),
								});
								return null;
							}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer));
						}),
						Effect.provide(redisLayer),
						Effect.provide(loggerLayer),
						Effect.provide(effectLoggerLayer),
					),
				);

				if (spawned?.machineId) {
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.info("Worker spawned successfully", {
								requestId,
								jobId,
								machineId: spawned.machineId,
								event: "worker.spawned",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
				}

				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("POST /jobs/:jobId/trigger-r2-event - Request completed", {
							requestId,
							jobId,
							statusCode: 200,
							durationMs: duration,
							machineId: spawned?.machineId || null,
							event: "request.completed",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				return c.json({
					success: true,
					jobId,
					status: "pending",
					machineId: spawned?.machineId || null,
					queuedAt: now,
				});
			} catch (error) {
				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.error("POST /jobs/:jobId/trigger-r2-event - Redis error", error, {
							requestId,
							jobId,
							statusCode: 500,
							durationMs: duration,
							event: "request.failed",
							errorType: "redis_error",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		});

	return app;
};

export const createJobRoutes = (): ReturnType<typeof buildJobRoutes> => {
	return buildJobRoutes();
};
