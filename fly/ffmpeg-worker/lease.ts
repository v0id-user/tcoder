/**
 * Worker Lease Management for RWOS
 *
 * Handles lease acquisition, renewal, and release for Fly Machine workers.
 * Leases track worker state and enable dead worker detection.
 */

import { Console, Effect } from "effect";
import { type RedisError, RedisService, redisEffect } from "./redis-client";

// =============================================================================
// Lease Configuration
// =============================================================================

export const LEASE_CONFIG = {
	/** Poll interval when waiting for jobs */
	POLL_INTERVAL_MS: 5_000,
} as const;

// =============================================================================
// Redis Keys (duplicated here to avoid cross-package imports)
// =============================================================================

const RedisKeys = {
	machinesPool: "machines:pool",
	jobsPending: "jobs:pending",
	jobsActive: "jobs:active",
	jobStatus: (jobId: string) => `jobs:status:${jobId}`,
} as const;

// =============================================================================
// Types
// =============================================================================

export interface WorkerState {
	readonly machineId: string;
	readonly startTime: number;
	readonly jobsProcessed: number;
}

// =============================================================================
// Lease Operations
// =============================================================================

/**
 * Initialize worker in machine pool.
 * Updates pool entry to "running" state and sets lastActiveAt.
 */
export const initializeWorker = (machineId: string): Effect.Effect<{ startedAt: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing pool entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					try {
						const parsed = JSON.parse(data);
						return {
							state: parsed.state || "running",
							lastActiveAt: Number(parsed.lastActiveAt) || now,
							createdAt: Number(parsed.createdAt) || now,
						};
					} catch {
						return null;
					}
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;
		const startedAt = existingEntry?.createdAt || now;

		// Update pool entry to running
		yield* Effect.tryPromise({
			try: async () => {
				await client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: now,
						createdAt,
					}),
				});
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* Console.log(`[Worker] Initialized in pool as running`);

		return { startedAt };
	});

/**
 * Update machine state in pool (running when processing, idle when waiting).
 */
export const updateMachineState = (
	machineId: string,
	state: "running" | "idle",
): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					try {
						const parsed = JSON.parse(data);
						return {
							state: parsed.state || "running",
							lastActiveAt: Number(parsed.lastActiveAt) || now,
							createdAt: Number(parsed.createdAt) || now,
						};
					} catch {
						return null;
					}
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;

		yield* redisEffect((client) =>
			client.hset(RedisKeys.machinesPool, {
				[machineId]: JSON.stringify({
					state,
					lastActiveAt: now,
					createdAt,
				}),
			}),
		);
	});

/**
 * Cleanup worker on exit (mark as stopped in pool).
 * Note: The machine itself will be stopped by the cron job when idle.
 */
export const cleanupWorker = (machineId: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					try {
						const parsed = JSON.parse(data);
						return {
							state: parsed.state || "stopped",
							lastActiveAt: Number(parsed.lastActiveAt) || now,
							createdAt: Number(parsed.createdAt) || now,
						};
					} catch {
						return null;
					}
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;

		// Mark as stopped (cron will handle actual Fly API stop)
		yield* redisEffect((client) =>
			client.hset(RedisKeys.machinesPool, {
				[machineId]: JSON.stringify({
					state: "stopped",
					lastActiveAt: now,
					createdAt,
				}),
			}),
		);

		yield* Console.log(`[Worker] Cleaned up, marked as stopped in pool`);
	});

/**
 * Pop a job from the queue atomically.
 */
export const popJob = (machineId: string): Effect.Effect<string | null, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// Upstash zpopmin returns array of { member, score } or empty array
		const popped = yield* Effect.tryPromise({
			try: () => client.zpopmin<string>(RedisKeys.jobsPending, 1),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!popped || popped.length === 0) {
			return null;
		}

		// Upstash returns [{ member, score }] or just the member string
		const jobId = typeof popped[0] === "string" ? popped[0] : (popped[0] as { member: string }).member;

		// Mark job as running
			const pipe = client.pipeline();
			pipe.hset(RedisKeys.jobStatus(jobId), {
				status: "running",
				machineId,
				startedAt: String(Date.now()),
			});
			pipe.hset(RedisKeys.jobsActive, { [jobId]: machineId });

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return jobId;
	});

/**
 * Get job data by ID.
 */
export const getJobData = (jobId: string): Effect.Effect<Record<string, string> | null, RedisError, RedisService> =>
	redisEffect(async (client) => {
		const data = await client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
		// Upstash returns null if key doesn't exist
		return data && Object.keys(data).length > 0 ? data : null;
	});

/**
 * Mark job as completed.
 */
export const completeJob = (jobId: string, duration: number): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), {
			status: "completed",
			completedAt: String(Date.now()),
			duration: String(duration),
		});
		pipe.hdel(RedisKeys.jobsActive, jobId);

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
	});

/**
 * Mark job as failed.
 */
export const failJob = (jobId: string, error: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), {
			status: "failed",
			completedAt: String(Date.now()),
			error,
		});
		pipe.hdel(RedisKeys.jobsActive, jobId);

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
	});
