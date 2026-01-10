/**
 * RWOS - Redis Worker Orchestration System
 *
 * Cloudflare Worker control plane for FFmpeg transcoding jobs.
 * Handles:
 * - API routes for job submission and status
 * - R2 event notifications (queue consumer)
 * - Scheduled stale job recovery (cron)
 */

import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../packages/logger";
import { createRoutes, createWebhookRoutes } from "./api/routes";
import { stopMachine } from "./orchestration/machine-pool";
import { type MessageBatch, type R2EventNotification, type RecoveryEnv, handleR2Events, recoverUploadingJob } from "./r2/events";
import { makeRedisLayer } from "./redis/client";
import { RWOS_CONFIG, RedisKeys, deserializeJobData, deserializeMachinePoolEntry } from "./redis/schema";

// Create base app - Bindings type not needed for RPC type inference
// Chain routes directly for proper RPC type inference
// See: https://hono.dev/docs/guides/best-practices#if-you-want-to-use-rpc-features
const routes = new Hono()
	.use(
		"*",
		cors({
			origin: "*",
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
			exposeHeaders: ["Content-Type"],
			credentials: false,
		}),
	)
	.get("/", (c) => c.json({ status: "ok", service: "tcoder" }))
	.route("/api", createRoutes())
	.route("/", createWebhookRoutes());

// Export routes and AppType for RPC client
// AppType must be the chained routes, not the base app
export { routes as app };
export type AppType = typeof routes;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return routes.fetch(request, env);
	},

	/**
	 * Queue handler for R2 event notifications.
	 * Triggered when objects are uploaded to the input bucket.
	 */
	async queue(batch: MessageBatch<R2EventNotification>, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(handleR2Events(batch, env));
	},

	/**
	 * Scheduled handler for stale job recovery.
	 * Runs every minute to detect dead workers and requeue their jobs.
	 */
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(handleScheduled(env));
	},
};

// =============================================================================
// Cron Handler - Stale Job Recovery
// =============================================================================

async function handleScheduled(env: Env) {
	const redis = Redis.fromEnv(env);
	const loggerLayer = makeLoggerLayer({ component: "Cron", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");

	await Effect.runPromise(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.info("Checking for idle machines to stop");
		}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
	);

	try {
		// Get all machines from pool
		const poolEntries = await redis.hgetall<Record<string, string>>(RedisKeys.machinesPool);
		if (!poolEntries || Object.keys(poolEntries).length === 0) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("No machines in pool");
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			await recoverStuckUploadingJobs(env);
			return;
		}

		const now = Date.now();
		const idleTimeout = RWOS_CONFIG.IDLE_TIMEOUT_MS;
		const machinesToStop: string[] = [];

		// Log total machines found
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Found machines in pool", {
					total: Object.keys(poolEntries).length,
					idleTimeoutMs: idleTimeout,
					idleTimeoutSeconds: Math.round(idleTimeout / 1000),
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		// Find idle machines that should be stopped
		for (const [machineId, entryJson] of Object.entries(poolEntries)) {
			const entry = deserializeMachinePoolEntry(machineId, entryJson);

			if (!entry) {
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.warn("Failed to deserialize machine pool entry", {
							machineId,
							entryJson: entryJson || "null",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				continue;
			}

			// Calculate idle duration (handle future timestamps due to clock skew)
			const idleDuration = now - entry.lastActiveAt;
			const isFutureTimestamp = idleDuration < 0;
			const idleDurationSeconds = Math.round(Math.abs(idleDuration) / 1000);
			const meetsIdleTimeout = !isFutureTimestamp && idleDuration >= idleTimeout;
			const shouldStop = entry.state === "idle" && meetsIdleTimeout;

			// Log details for each machine
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Checking machine", {
						machineId,
						state: entry.state,
						lastActiveAt: entry.lastActiveAt,
						lastActiveAtISO: new Date(entry.lastActiveAt).toISOString(),
						now,
						nowISO: new Date(now).toISOString(),
						idleDurationMs: idleDuration,
						idleDurationSeconds,
						isFutureTimestamp,
						idleTimeoutMs: idleTimeout,
						meetsIdleTimeout,
						shouldStop,
						reason: shouldStop
							? "Idle and exceeds timeout"
							: entry.state !== "idle"
								? `State is "${entry.state}", not idle`
								: isFutureTimestamp
									? "LastActiveAt is in the future (clock skew)"
									: `Idle for ${idleDurationSeconds}s, needs ${Math.round(idleTimeout / 1000)}s`,
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			// Check if machine is idle and has been idle for more than IDLE_TIMEOUT_MS
			if (shouldStop) {
				machinesToStop.push(machineId);
			}
		}

		if (machinesToStop.length === 0) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("No idle machines to stop after checking all machines");
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			await recoverStuckUploadingJobs(env);
			return;
		}

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Found idle machines to stop", { count: machinesToStop.length, machineIds: machinesToStop });
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		// Stop each idle machine using Effect
		const redisLayer = makeRedisLayer({
			UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
			UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
		});

		const flyConfig = {
			apiToken: env.FLY_API_TOKEN,
			appName: env.FLY_APP_NAME,
		};

		let stoppedCount = 0;
		let cleanedCount = 0;
		for (const machineId of machinesToStop) {
			try {
				await Effect.runPromise(
					stopMachine(machineId, flyConfig).pipe(
						Effect.provide(redisLayer),
						Effect.provide(loggerLayer),
						Effect.provide(effectLoggerLayer),
					),
				);
				stoppedCount++;
			} catch (e) {
				// Check if error is 404 (machine not found) - clean up stale Redis entry
				const is404 = e && typeof e === "object" && "_tag" in e && e._tag === "HttpError" && "status" in e && e.status === 404;

				if (is404) {
					// Machine doesn't exist in Fly, clean up stale Redis entry
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.info("Machine not found in Fly, cleaning up stale Redis entry", { machineId });
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);

					// Remove from pool and stopped set using direct Redis client
					const pipe = redis.pipeline();
					pipe.hdel(RedisKeys.machinesPool, machineId);
					pipe.srem(RedisKeys.machinesStopped, machineId);
					await pipe.exec();

					cleanedCount++;
				} else {
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.error("Failed to stop machine", e, { machineId });
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
				}
			}
		}

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Stopped idle machines", {
					stoppedCount,
					cleanedCount,
					total: machinesToStop.length,
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
	} catch (e) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.error("Error stopping idle machines", e);
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
	}

	// Recover stuck uploading jobs
	try {
		await recoverStuckUploadingJobs(env);
	} catch (e) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.error("Error recovering uploading jobs", e);
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
	}
}

/**
 * Recover jobs stuck in "uploading" status.
 * Checks for jobs that should have transitioned to "pending" but didn't due to missing R2 events.
 */
async function recoverStuckUploadingJobs(env: Env) {
	const redis = Redis.fromEnv(env);
	const loggerLayer = makeLoggerLayer({ component: "Cron", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");
	const now = Date.now();

	// Calculate recovery threshold: early proactive check (don't wait for presigned URL expiry)
	const recoveryThresholdMs = RWOS_CONFIG.UPLOADING_RECOVERY_CHECK_SECONDS * 1000;
	const failureThresholdMs = RWOS_CONFIG.UPLOADING_FAILURE_THRESHOLD_SECONDS * 1000;

	await Effect.runPromise(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.info("Checking for stuck uploading jobs", {
				recoveryThresholdMs,
				recoveryThresholdSeconds: RWOS_CONFIG.UPLOADING_RECOVERY_CHECK_SECONDS,
				failureThresholdMs,
				failureThresholdSeconds: RWOS_CONFIG.UPLOADING_FAILURE_THRESHOLD_SECONDS,
			});
		}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
	);

	// Try to find uploading jobs by scanning job status keys
	// Note: This is a best-effort approach. For production, consider maintaining a SET of uploading job IDs.
	let cursor: string | number = 0;
	let checkedCount = 0;
	let recoveredCount = 0;
	let failedCount = 0;
	const maxChecks = 100; // Limit checks per cron run to avoid timeout

	try {
		// Use SCAN to find job status keys (pattern: jobs:status:*)
		// Upstash Redis REST API supports SCAN with cursor
		do {
			const result: [string | number, string[]] = await redis.scan(cursor, {
				match: "jobs:status:*",
				count: 50,
			});
			// SCAN returns [cursor, keys[]] where cursor can be string or number
			cursor = typeof result[0] === "string" ? result[0] : Number(result[0]);
			const keys = (Array.isArray(result[1]) ? result[1] : []) as string[];

			for (const key of keys) {
				if (checkedCount >= maxChecks) {
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.info("Reached max checks limit, stopping scan", { maxChecks });
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					break;
				}

				checkedCount++;

				// Extract job ID from key (format: jobs:status:{jobId})
				const jobId = key.replace("jobs:status:", "");
				if (!jobId) continue;

				// Get job data
				const jobData = await redis.hgetall<Record<string, string>>(key);
				if (!jobData || Object.keys(jobData).length === 0) continue;

				const job = deserializeJobData(jobData);
				if (!job) continue;

				// Only process jobs in "uploading" status
				if (job.status !== "uploading") continue;

				// Check if job is old enough to recover
				const jobAge = now - job.timestamps.createdAt;
				if (jobAge < recoveryThresholdMs) {
					// Job is too new, skip
					continue;
				}

				// Check if file exists and recover
				if (!job.inputKey) {
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.warn("Job has no inputKey, marking as failed", { jobId });
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
					await redis.hset(key, {
						status: "failed",
						error: "Upload never completed (no input key)",
						completedAt: String(now),
					});
					failedCount++;
					continue;
				}

				// Attempt recovery
				const recoveryEnv: RecoveryEnv = {
					...env,
					INPUT_BUCKET: env.INPUT_BUCKET,
				};

				const recovered = await recoverUploadingJob(redis, recoveryEnv, jobId, job.inputKey);

				if (recovered) {
					recoveredCount++;
				} else {
					// File doesn't exist - check if job exceeds failure threshold
					if (jobAge > failureThresholdMs) {
						await Effect.runPromise(
							Effect.gen(function* () {
								const logger = yield* LoggerService;
								yield* logger.warn("Job exceeds failure threshold and file not found, marking as failed", {
									jobId,
									jobAgeSeconds: Math.round(jobAge / 1000),
									failureThresholdSeconds: RWOS_CONFIG.UPLOADING_FAILURE_THRESHOLD_SECONDS,
								});
							}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
						);
						await redis.hset(key, {
							status: "failed",
							error: "Upload never completed (file not found after extended wait)",
							completedAt: String(now),
						});
						failedCount++;
					}
				}
			}

			if (checkedCount >= maxChecks) break;
		} while (cursor !== 0 && cursor !== "0");

		if (checkedCount > 0) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Recovery scan completed", {
						checkedCount,
						recoveredCount,
						failedCount,
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
		}
	} catch (error) {
		// SCAN might not be available or might fail - log and continue
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Could not scan for uploading jobs (this is okay)", {
					error: error instanceof Error ? error.message : String(error),
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
	}
}

// =============================================================================
// Types
// =============================================================================

interface Env {
	// R2 bindings
	INPUT_BUCKET: R2Bucket;
	OUTPUT_BUCKET: R2Bucket;
	// Queue binding
	TRANSCODE_QUEUE: Queue<R2EventNotification>;
	// Redis credentials
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
	// Fly config
	FLY_API_TOKEN: string;
	FLY_APP_NAME: string;
	FLY_REGION: string;
	WEBHOOK_BASE_URL: string;
	// R2 credentials for presigned URLs
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_INPUT_BUCKET_NAME: string;
	R2_OUTPUT_BUCKET_NAME: string;
}

interface ScheduledEvent {
	cron: string;
	scheduledTime: number;
}

interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

interface ExportedHandler<E> {
	fetch: (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>;
	queue?: (batch: MessageBatch<R2EventNotification>, env: E, ctx: ExecutionContext) => void | Promise<void>;
	scheduled?: (event: ScheduledEvent, env: E, ctx: ExecutionContext) => void | Promise<void>;
}
