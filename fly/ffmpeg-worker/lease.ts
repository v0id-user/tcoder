/**
 * Worker Lease Management for RWOS
 *
 * Handles lease acquisition, renewal, and release for Fly Machine workers.
 * Leases track worker state and enable dead worker detection.
 */

import { Effect } from "effect";
import { LoggerService, logLeaseCleanup, logLeaseInitialized, logLeaseStateUpdate } from "../../packages/logger";
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
export const initializeWorker = (machineId: string): Effect.Effect<{ startedAt: number }, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[initializeWorker] Entering", { machineId });
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

		yield* logLeaseInitialized(logger, machineId);

		const duration = Date.now() - startTime;
		yield* logger.debug("[initializeWorker] Exiting", { machineId, startedAt, duration: `${duration}ms` });
		return { startedAt };
	});

/**
 * Update machine state in pool (running when processing, idle when waiting).
 */
export const updateMachineState = (
	machineId: string,
	state: "running" | "idle",
): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[updateMachineState] Entering", { machineId, state });
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

		yield* redisEffect(
			(client) =>
				client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state,
						lastActiveAt: now,
						createdAt,
					}),
				}),
			"updateMachineState",
		);

		yield* logLeaseStateUpdate(logger, machineId, state);
		const duration = Date.now() - startTime;
		yield* logger.debug("[updateMachineState] Exiting", { machineId, state, duration: `${duration}ms` });
	});

/**
 * Cleanup worker on exit (mark as stopped in pool).
 * Note: The machine itself will be stopped by the cron job when idle.
 */
export const cleanupWorker = (machineId: string): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[cleanupWorker] Entering", { machineId });
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
		yield* redisEffect(
			(client) =>
				client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "stopped",
						lastActiveAt: now,
						createdAt,
					}),
				}),
			"cleanupWorker",
		);

		yield* logLeaseCleanup(logger, machineId);
		const duration = Date.now() - startTime;
		yield* logger.debug("[cleanupWorker] Exiting", { machineId, duration: `${duration}ms` });
	});

/**
 * Pop a job from the queue atomically.
 */
export const popJob = (machineId: string): Effect.Effect<string | null, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[popJob] Entering", { machineId });

		// Upstash zpopmin returns array of { member, score } or empty array
		const popped = yield* Effect.tryPromise({
			try: () => client.zpopmin<string>(RedisKeys.jobsPending, 1),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!popped || popped.length === 0) {
			const duration = Date.now() - startTime;
			yield* logger.debug("[popJob] Exiting - no jobs available", { machineId, duration: `${duration}ms` });
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

		const duration = Date.now() - startTime;
		yield* logger.debug("[popJob] Exiting", { machineId, jobId, duration: `${duration}ms` });
		return jobId;
	});

/**
 * Get job data by ID.
 */
export const getJobData = (jobId: string): Effect.Effect<Record<string, string> | null, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const startTime = Date.now();
		yield* logger.debug("[getJobData] Entering", { jobId });
		const result = yield* redisEffect(
			async (client) => {
				const data = await client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
				// Upstash returns null if key doesn't exist
				return data && Object.keys(data).length > 0 ? data : null;
			},
			"getJobData",
		);
		const duration = Date.now() - startTime;
		yield* logger.debug("[getJobData] Exiting", { jobId, found: result !== null, duration: `${duration}ms` });
		return result;
	});

/**
 * Job output structure for persistence.
 */
export interface JobOutput {
	readonly quality: string;
	readonly url: string;
}

/**
 * Mark job as completed.
 * Saves outputs directly to Redis for reliability (webhook is a backup).
 */
export const completeJob = (
	jobId: string,
	duration: number,
	outputs?: JobOutput[],
): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[completeJob] Entering", { jobId, duration, outputCount: outputs?.length ?? 0 });
		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), {
			status: "completed",
			completedAt: String(Date.now()),
			duration: String(duration),
			...(outputs && outputs.length > 0 && { outputs: JSON.stringify(outputs) }),
		});
		pipe.hdel(RedisKeys.jobsActive, jobId);

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
		const execDuration = Date.now() - startTime;
		yield* logger.debug("[completeJob] Exiting", { jobId, duration, outputCount: outputs?.length ?? 0, execDuration: `${execDuration}ms` });
	});

/**
 * Mark job as failed.
 */
export const failJob = (jobId: string, error: string): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[failJob] Entering", { jobId, error });
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
		const execDuration = Date.now() - startTime;
		yield* logger.debug("[failJob] Exiting", { jobId, error, execDuration: `${execDuration}ms` });
	});
