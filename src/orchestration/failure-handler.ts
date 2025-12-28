/**
 * Shared Failure Handler for RWOS
 *
 * Handles job failures with retry logic and worker failure tracking.
 * When a worker fails multiple jobs, it is marked as "failed" state.
 */

import { Effect } from "effect";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys, deserializeMachinePoolEntry, serializeMachinePoolEntry } from "../redis/schema";
import { failJob, requeueJob, type JobManagerError } from "./job-manager";

// =============================================================================
// Types
// =============================================================================

export type FailureHandlerError = RedisError | JobManagerError;

export interface FailureResult {
	readonly jobRequeued: boolean;
	readonly jobFailed: boolean;
	readonly workerMarkedAsFailed: boolean;
	readonly workerFailureCount: number;
}

// =============================================================================
// Worker Failure Tracking
// =============================================================================

/**
 * Get current worker failure count from Redis.
 */
const getWorkerFailureCount = (machineId: string): Effect.Effect<number, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const data = yield* Effect.tryPromise({
			try: async () => {
				const entryData = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (!entryData) {
					return null;
				}
				const entry = deserializeMachinePoolEntry(machineId, entryData);
				return entry?.failureCount ?? 0;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
		return data ?? 0;
	});

/**
 * Increment worker failure count and return new count.
 */
const incrementWorkerFailureCount = (machineId: string): Effect.Effect<number, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt and other fields
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					return deserializeMachinePoolEntry(machineId, data);
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
					[machineId]: serializeMachinePoolEntry({
						machineId,
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

		return newFailureCount;
	});

/**
 * Mark worker as failed state.
 */
const markWorkerFailed = (machineId: string, reason: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					return deserializeMachinePoolEntry(machineId, data);
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
					[machineId]: serializeMachinePoolEntry({
						machineId,
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
	});

// =============================================================================
// Main Failure Handler
// =============================================================================

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
 * @returns Result indicating what actions were taken
 */
export const handleJobFailure = (
	jobId: string,
	machineId: string,
	error: string,
): Effect.Effect<FailureResult, FailureHandlerError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// Get current job retry count
		const jobData = yield* Effect.tryPromise({
			try: () => client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId)),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!jobData) {
			return yield* Effect.fail({ _tag: "JobNotFound" as const, jobId });
		}

		const retries = Number(jobData.retries || 0);
		let jobRequeued = false;
		let jobFailed = false;

		// Handle job retry logic
		if (retries < RWOS_CONFIG.MAX_JOB_RETRIES) {
			// Requeue job for retry
			const requeued = yield* requeueJob(jobId);
			jobRequeued = requeued;
		} else {
			// Max retries exceeded, mark job as failed
			yield* failJob(jobId, error);
			jobFailed = true;
		}

		// Increment worker failure count
		const newFailureCount = yield* incrementWorkerFailureCount(machineId);

		// Check if worker should be marked as failed
		let workerMarkedAsFailed = false;
		if (newFailureCount >= RWOS_CONFIG.MAX_WORKER_FAILURES) {
			yield* markWorkerFailed(machineId, `Worker failed ${newFailureCount} jobs`);
			workerMarkedAsFailed = true;
		}

		return {
			jobRequeued,
			jobFailed,
			workerMarkedAsFailed,
			workerFailureCount: newFailureCount,
		};
	});
