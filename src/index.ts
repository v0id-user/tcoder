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
import { Hono } from "hono";
import { createRoutes, createWebhookRoutes } from "./api/routes";
import { type MessageBatch, type R2EventNotification, handleR2Events } from "./r2/events";

const app = new Hono();

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "rwos" }));

// Mount API routes
app.route("/api", createRoutes());

// Mount webhook routes
app.route("/", createWebhookRoutes());

export default {
	fetch: app.fetch as ExportedHandler<Env>["fetch"],

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

	console.log("[Cron] Checking for stale jobs...");

	try {
		// Get all worker leases
		const leases = await redis.hgetall<Record<string, string>>("workers:leases");
		if (!leases) {
			console.log("[Cron] No active leases");
			return;
		}

		const now = Date.now();
		const expiredMachines: string[] = [];

		// Find expired leases
		for (const [machineId, expiryStr] of Object.entries(leases)) {
			const expiry = Number(expiryStr);
			if (expiry < now) {
				expiredMachines.push(machineId);
			}
		}

		if (expiredMachines.length === 0) {
			console.log("[Cron] No expired leases");
			return;
		}

		console.log(`[Cron] Found ${expiredMachines.length} expired leases`);

		// Get active jobs assigned to expired machines
		const activeJobs = await redis.hgetall<Record<string, string>>("jobs:active");
		if (!activeJobs) return;

		const jobsToRequeue: string[] = [];
		for (const [jobId, machineId] of Object.entries(activeJobs)) {
			if (expiredMachines.includes(machineId)) {
				jobsToRequeue.push(jobId);
			}
		}

		if (jobsToRequeue.length === 0) {
			// Just cleanup expired leases
			await redis.hdel("workers:leases", ...expiredMachines);
			console.log(`[Cron] Cleaned up ${expiredMachines.length} expired leases`);
			return;
		}

		console.log(`[Cron] Requeuing ${jobsToRequeue.length} stale jobs`);

		// Requeue jobs
		const pipe = redis.pipeline();
		for (const jobId of jobsToRequeue) {
			// Get current retry count
			const jobData = await redis.hgetall<Record<string, string>>(`jobs:status:${jobId}`);
			const retries = Number(jobData?.retries || 0);

			if (retries >= 3) {
				// Max retries, mark as failed
				pipe.hset(`jobs:status:${jobId}`, {
					status: "failed",
					error: "Max retries exceeded (worker died)",
					completedAt: String(now),
				});
				pipe.hdel("jobs:active", jobId);
			} else {
				// Requeue
				pipe.zadd("jobs:pending", { score: now, member: jobId });
				pipe.hset(`jobs:status:${jobId}`, {
					status: "pending",
					retries: String(retries + 1),
					machineId: "",
				});
				pipe.hdel("jobs:active", jobId);
			}
		}

		// Cleanup expired leases and decrement counter
		pipe.hdel("workers:leases", ...expiredMachines);
		for (const machineId of expiredMachines) {
			pipe.del(`workers:meta:${machineId}`);
		}

		await pipe.exec();
		console.log(`[Cron] Requeued ${jobsToRequeue.length} jobs, cleaned ${expiredMachines.length} leases`);
	} catch (e) {
		console.error("[Cron] Error:", e);
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
