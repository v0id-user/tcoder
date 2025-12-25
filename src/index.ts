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
import { createRoutes, createWebhookRoutes } from "./api/routes";
import { stopMachine } from "./orchestration/machine-pool";
import { type MessageBatch, type R2EventNotification, type RecoveryEnv, handleR2Events, recoverUploadingJob } from "./r2/events";
import { makeRedisLayer } from "./redis/client";
import { RWOS_CONFIG, RedisKeys, deserializeJobData, deserializeMachinePoolEntry } from "./redis/schema";

// =============================================================================
// Dev Mode Detection
// =============================================================================

/**
 * Check if we're in dev mode (local development with Docker worker).
 */
const isDevMode = (env: Env): boolean => {
	return !env.FLY_API_TOKEN || env.FLY_API_TOKEN === "" || process.env.NODE_ENV === "development";
};

const app = new Hono();

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "tcoder" }));

// Mount API routes
app.route("/api", createRoutes());

// Mount webhook routes
app.route("/", createWebhookRoutes());

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		// Log dev mode status on first request
		if (!(globalThis as { _devModeLogged?: boolean })._devModeLogged) {
			const devMode = isDevMode(env);
			console.log(`[Worker] ${devMode ? "🔧 DEV MODE" : "🚀 PRODUCTION MODE"}`);
			(globalThis as { _devModeLogged?: boolean })._devModeLogged = true;
		}
		return app.fetch(request, env);
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

	// Skip machine stopping in dev mode - local Docker worker runs continuously
	if (!env.FLY_API_TOKEN || env.FLY_API_TOKEN === "" || process.env.NODE_ENV === "development") {
		console.log("[Cron] Dev mode: Skipping idle machine stop (local Docker worker runs continuously)");
		await recoverStuckUploadingJobs(env);
		return;
	}

	console.log("[Cron] Checking for idle machines to stop...");

	try {
		// Get all machines from pool
		const poolEntries = await redis.hgetall<Record<string, string>>(RedisKeys.machinesPool);
		if (!poolEntries || Object.keys(poolEntries).length === 0) {
			console.log("[Cron] No machines in pool");
			await recoverStuckUploadingJobs(env);
			return;
		}

		const now = Date.now();
		const idleTimeout = RWOS_CONFIG.IDLE_TIMEOUT_MS;
		const machinesToStop: string[] = [];

		// Find idle machines that should be stopped
		for (const [machineId, entryJson] of Object.entries(poolEntries)) {
			const entry = deserializeMachinePoolEntry(machineId, entryJson);
			if (!entry) continue;

			// Check if machine is idle and has been idle for more than IDLE_TIMEOUT_MS
			if (entry.state === "idle" && now - entry.lastActiveAt >= idleTimeout) {
				machinesToStop.push(machineId);
			}
		}

		if (machinesToStop.length === 0) {
			console.log("[Cron] No idle machines to stop");
			await recoverStuckUploadingJobs(env);
			return;
		}

		console.log(`[Cron] Found ${machinesToStop.length} idle machines to stop`);

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
		for (const machineId of machinesToStop) {
			try {
				await Effect.runPromise(stopMachine(machineId, flyConfig).pipe(Effect.provide(redisLayer)));
				stoppedCount++;
			} catch (e) {
				console.error(`[Cron] Failed to stop machine ${machineId}:`, e);
			}
		}

		console.log(`[Cron] Stopped ${stoppedCount}/${machinesToStop.length} idle machines`);
	} catch (e) {
		console.error("[Cron] Error stopping idle machines:", e);
	}

	// Recover stuck uploading jobs
	try {
		await recoverStuckUploadingJobs(env);
	} catch (e) {
		console.error("[Cron] Error recovering uploading jobs:", e);
	}
}

/**
 * Recover jobs stuck in "uploading" status.
 * Checks for jobs that should have transitioned to "pending" but didn't due to missing R2 events.
 */
async function recoverStuckUploadingJobs(env: Env) {
	const redis = Redis.fromEnv(env);
	const now = Date.now();

	// Calculate recovery threshold: presigned URL expiry + buffer
	const recoveryThresholdMs = (RWOS_CONFIG.PRESIGNED_URL_EXPIRY_SECONDS + RWOS_CONFIG.UPLOADING_RECOVERY_BUFFER_SECONDS) * 1000;

	console.log("[Cron] Checking for stuck uploading jobs...");

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
					console.log(`[Cron] Reached max checks limit (${maxChecks}), stopping scan`);
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
					console.log(`[Cron] Job ${jobId} has no inputKey, marking as failed`);
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
					// File doesn't exist - check if job is very old (presumed failed upload)
					const veryOldThreshold = recoveryThresholdMs * 2; // 2x the recovery threshold
					if (jobAge > veryOldThreshold) {
						console.log(`[Cron] Job ${jobId} is very old (${Math.round(jobAge / 1000)}s) and file not found, marking as failed`);
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
			console.log(`[Cron] Checked ${checkedCount} jobs, recovered ${recoveredCount} stuck uploading jobs, failed ${failedCount} old jobs`);
		}
	} catch (error) {
		// SCAN might not be available or might fail - log and continue
		console.log(`[Cron] Could not scan for uploading jobs (this is okay): ${error instanceof Error ? error.message : String(error)}`);
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
