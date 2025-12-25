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
	/** Machine TTL in milliseconds (5 minutes) */
	MACHINE_TTL_MS: 300_000,

	/** Maximum jobs per machine */
	MAX_JOBS: 3,

	/** Drain buffer - start draining when this much time remains */
	DRAIN_BUFFER_MS: 60_000,

	/** Lease buffer beyond TTL for dead worker detection */
	LEASE_BUFFER_MS: 30_000,

	/** Poll interval when waiting for jobs */
	POLL_INTERVAL_MS: 5_000,
} as const;

// =============================================================================
// Redis Keys (duplicated here to avoid cross-package imports)
// =============================================================================

const RedisKeys = {
	workersLeases: "workers:leases",
	workerMeta: (machineId: string) => `workers:meta:${machineId}`,
	countersActiveMachines: "counters:active_machines",
	jobsPending: "jobs:pending",
	jobsActive: "jobs:active",
	jobStatus: (jobId: string) => `jobs:status:${jobId}`,
} as const;

// =============================================================================
// Lease Types
// =============================================================================

export interface WorkerLease {
	readonly machineId: string;
	readonly expiresAt: number;
	readonly startedAt: number;
	readonly jobsProcessed: number;
}

export interface WorkerState {
	readonly machineId: string;
	readonly startTime: number;
	readonly jobsProcessed: number;
	readonly draining: boolean;
}

// =============================================================================
// Lease Operations
// =============================================================================

/**
 * Verify and activate a lease for this worker machine.
 *
 * The spawner registers a lease with status "starting" when creating the machine.
 * This function verifies the lease exists and activates it for processing.
 * Falls back to creating a new lease if none exists (local dev / edge cases).
 */
export const verifyAndActivateLease = (machineId: string): Effect.Effect<WorkerLease, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// Check for existing lease from spawner
		const existingExpiry = yield* Effect.tryPromise({
			try: () => client.hget<string>(RedisKeys.workersLeases, machineId),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		// Get existing metadata to preserve startedAt if present
		const existingMeta = yield* Effect.tryPromise({
			try: () => client.hgetall<Record<string, string>>(RedisKeys.workerMeta(machineId)),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const now = Date.now();
		const expiresAt = now + LEASE_CONFIG.MACHINE_TTL_MS + LEASE_CONFIG.LEASE_BUFFER_MS;
		const startedAt = existingMeta?.startedAt ? Number(existingMeta.startedAt) : now;

		// Update/create lease and activate worker
			const pipe = client.pipeline();
		pipe.hset(RedisKeys.workersLeases, { [machineId]: String(expiresAt) });
			pipe.hset(RedisKeys.workerMeta(machineId), {
				machineId,
				startedAt: String(startedAt),
				jobsProcessed: "0",
				status: "active",
			});
			// Set TTL on worker meta
			pipe.expire(RedisKeys.workerMeta(machineId), Math.ceil((LEASE_CONFIG.MACHINE_TTL_MS + LEASE_CONFIG.LEASE_BUFFER_MS) / 1000));

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (existingExpiry) {
			yield* Console.log(`[Lease] Activated existing lease for ${machineId}`);
		} else {
			yield* Console.log(`[Lease] Created new lease for ${machineId} (no spawner lease found)`);
		}

		return {
			machineId,
			expiresAt,
			startedAt,
			jobsProcessed: 0,
		};
	});

/**
 * Extend lease expiry (heartbeat).
 */
export const extendLease = (machineId: string, extensionMs: number): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const newExpiry = Date.now() + extensionMs + LEASE_CONFIG.LEASE_BUFFER_MS;

		yield* redisEffect((client) => client.hset(RedisKeys.workersLeases, { [machineId]: String(newExpiry) }));

		yield* Console.log(`[Lease] Extended to ${new Date(newExpiry).toISOString()}`);
	});

/**
 * Update jobs processed count.
 */
export const updateJobsProcessed = (machineId: string, count: number): Effect.Effect<void, RedisError, RedisService> =>
	redisEffect((client) =>
		client.hset(RedisKeys.workerMeta(machineId), {
			jobsProcessed: String(count),
			lastJobAt: String(Date.now()),
		}),
	);

/**
 * Set worker to draining status.
 */
export const setDraining = (machineId: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		yield* redisEffect((client) => client.hset(RedisKeys.workerMeta(machineId), { status: "draining" }));
		yield* Console.log(`[Lease] Worker ${machineId} entering drain mode`);
	});

/**
 * Release lease and cleanup (called on graceful exit).
 */
export const releaseLease = (machineId: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
			const pipe = client.pipeline();
			pipe.hdel(RedisKeys.workersLeases, machineId);
			pipe.del(RedisKeys.workerMeta(machineId));
			pipe.decr(RedisKeys.countersActiveMachines);

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* Console.log(`[Lease] Released for ${machineId}`);
	});

/**
 * Check if worker should drain (TTL near or max jobs reached).
 */
export const shouldDrain = (state: WorkerState): boolean => {
	const elapsed = Date.now() - state.startTime;
	const remaining = LEASE_CONFIG.MACHINE_TTL_MS - elapsed;

	return remaining < LEASE_CONFIG.DRAIN_BUFFER_MS || state.jobsProcessed >= LEASE_CONFIG.MAX_JOBS;
};

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
