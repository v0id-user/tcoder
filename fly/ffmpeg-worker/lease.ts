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

// Failure tracking constants (duplicated from src/redis/schema to avoid Docker path issues)
const MAX_JOB_RETRIES = 3;
const MAX_WORKER_FAILURES = 3;

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

		// Get existing pool entry to preserve createdAt and failureCount
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
							failureCount: parsed.failureCount !== undefined ? Number(parsed.failureCount) : undefined,
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
		const failureCount = existingEntry?.failureCount;

		// Update pool entry to running (preserve failureCount if it exists)
		yield* Effect.tryPromise({
			try: async () => {
				await client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: now,
						createdAt,
						...(failureCount !== undefined && { failureCount }),
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
 * Update machine state in pool (running when processing, idle when waiting, failed when worker fails too many jobs).
 */
export const updateMachineState = (
	machineId: string,
	state: "running" | "idle" | "failed",
): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[updateMachineState] Entering", { machineId, state });
		const now = Date.now();

		// Get existing entry to preserve createdAt and failureCount
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
							failureCount: parsed.failureCount !== undefined ? Number(parsed.failureCount) : undefined,
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
		const failureCount = existingEntry?.failureCount;

		// Only update lastActiveAt when machine is doing work (running state)
		// When transitioning to idle/failed, preserve the existing lastActiveAt
		// so we can track how long the machine has been idle
		const lastActiveAt =
			state === "running" ? now : existingEntry?.lastActiveAt || now;

		yield* redisEffect(
			(client) =>
				client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state,
						lastActiveAt,
						createdAt,
						...(failureCount !== undefined && { failureCount }),
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

		// Get existing entry to preserve createdAt and failureCount
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
							failureCount: parsed.failureCount !== undefined ? Number(parsed.failureCount) : undefined,
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
		const failureCount = existingEntry?.failureCount;

		// Mark as stopped (cron will handle actual Fly API stop)
		yield* redisEffect(
			(client) =>
				client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "stopped",
						lastActiveAt: now,
						createdAt,
						...(failureCount !== undefined && { failureCount }),
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
		const result = yield* redisEffect(async (client) => {
			const data = await client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
			// Upstash returns null if key doesn't exist
			return data && Object.keys(data).length > 0 ? data : null;
		}, "getJobData");
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

		// Build updates object with explicit string values to avoid serialization issues
		const updates: Record<string, string> = {
			status: "completed",
			completedAt: String(Date.now()),
			duration: String(duration),
		};

		if (outputs && outputs.length > 0) {
			const serialized = JSON.stringify(outputs);
			updates.outputs = serialized;
			// Debug log to verify serialization
			yield* logger.debug("[completeJob] Serialized outputs", {
				outputCount: outputs.length,
				serialized: serialized.substring(0, 100),
			});
		}

		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), updates);
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
 * Requeue a job (for retry after failure).
 */
const requeueJob = (jobId: string): Effect.Effect<boolean, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;

		const jobData = yield* Effect.tryPromise({
			try: () => client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId)),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!jobData || Object.keys(jobData).length === 0) {
			return false;
		}

		const retries = Number(jobData.retries || 0);
		if (retries >= MAX_JOB_RETRIES) {
			return false;
		}

		yield* Effect.tryPromise({
			try: async () => {
				const pipe = client.pipeline();
				pipe.zadd(RedisKeys.jobsPending, { score: Date.now(), member: jobId });
				pipe.hset(RedisKeys.jobStatus(jobId), {
					status: "pending",
					retries: String(retries + 1),
					machineId: "",
				});
				pipe.hdel(RedisKeys.jobsActive, jobId);
				await pipe.exec();
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return true;
	});

/**
 * Get current worker failure count from Redis.
 */
const getWorkerFailureCount = (machineId: string): Effect.Effect<number, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const data = yield* Effect.tryPromise({
			try: async () => {
				const entryData = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (!entryData) {
					return 0;
				}
				try {
					const parsed = JSON.parse(entryData);
					return Number(parsed.failureCount || 0);
				} catch {
					return 0;
				}
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
		return data;
	});

/**
 * Increment worker failure count and return new count.
 */
const incrementWorkerFailureCount = (machineId: string): Effect.Effect<number, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt and other fields
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
							failureCount: Number(parsed.failureCount || 0),
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
		const currentFailureCount = existingEntry?.failureCount ?? 0;
		const newFailureCount = currentFailureCount + 1;

		// Update pool entry with incremented failure count
		yield* Effect.tryPromise({
			try: async () => {
				await client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: existingEntry?.state || "running",
						lastActiveAt: now,
						createdAt,
						failureCount: newFailureCount,
					}),
				});
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* logger.debug("[incrementWorkerFailureCount] Worker failure count incremented", {
			machineId,
			newFailureCount,
		});

		return newFailureCount;
	});

/**
 * Mark worker as failed state.
 */
const markWorkerFailed = (machineId: string, reason: string): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
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
							failureCount: Number(parsed.failureCount || 0),
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
		const failureCount = existingEntry?.failureCount ?? 0;

		// Update pool entry to failed state
		yield* Effect.tryPromise({
			try: async () => {
				await client.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "failed",
						lastActiveAt: now,
						createdAt,
						failureCount,
					}),
				});
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* logger.error("Worker marked as failed", undefined, { machineId, reason, failureCount });
	});

/**
 * Mark job as failed (internal helper, used by handleJobFailure).
 */
const failJobInternal = (jobId: string, error: string): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;
		const startTime = Date.now();
		yield* logger.debug("[failJobInternal] Entering", { jobId, error });
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
		yield* logger.debug("[failJobInternal] Exiting", { jobId, error, execDuration: `${execDuration}ms` });
	});

/**
 * Handle job failure with retry logic and worker failure tracking.
 *
 * Flow:
 * 1. Get current job retry count
 * 2. If retries < MAX_JOB_RETRIES: requeue job (increment job retry count)
 * 3. If retries >= MAX_JOB_RETRIES: mark job as failed
 * 4. Increment worker failure count
 * 5. If worker failure count >= MAX_WORKER_FAILURES: mark worker as "failed"
 *
 * @param jobId - The job ID that failed
 * @param machineId - The machine ID that was processing the job
 * @param error - Error message describing the failure
 */
export const handleJobFailure = (
	jobId: string,
	machineId: string,
	error: string,
): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const { client } = yield* RedisService;

		// Get current job retry count
		const jobData = yield* Effect.tryPromise({
			try: () => client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId)),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!jobData || Object.keys(jobData).length === 0) {
			yield* logger.error("Job not found when handling failure", undefined, { jobId });
			return;
		}

		const retries = Number(jobData.retries || 0);

		// Handle job retry logic
		if (retries < MAX_JOB_RETRIES) {
			// Requeue job for retry
			const requeued = yield* requeueJob(jobId);
			if (requeued) {
				yield* logger.info("Job requeued for retry", { jobId, retries: retries + 1 });
			}
		} else {
			// Max retries exceeded, mark job as failed
			yield* failJobInternal(jobId, error);
			yield* logger.info("Job failed - max retries exceeded", { jobId, retries });
		}

		// Increment worker failure count
		const newFailureCount = yield* incrementWorkerFailureCount(machineId);

		// Check if worker should be marked as failed
		if (newFailureCount >= MAX_WORKER_FAILURES) {
			yield* markWorkerFailed(machineId, `Worker failed ${newFailureCount} jobs`);
			yield* updateMachineState(machineId, "failed");
		}
	});

/**
 * Mark job as failed (legacy function, now wraps handleJobFailure).
 * @deprecated Use handleJobFailure instead for proper retry and worker tracking.
 */
export const failJob = (jobId: string, error: string): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		// Try to get machineId from job data, fallback to empty string if not found
		const { client } = yield* RedisService;
		const jobDataResult = yield* Effect.tryPromise({
			try: () => client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId)),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		}).pipe(Effect.catchAll(() => Effect.succeed(null as Record<string, string> | null)));

		const machineId = jobDataResult?.machineId || "";
		if (machineId) {
			yield* handleJobFailure(jobId, machineId, error);
		} else {
			// Fallback to direct failure if machineId not found
			yield* logger.warn("failJob called without machineId, using direct failure", { jobId });
			yield* failJobInternal(jobId, error);
		}
	});
