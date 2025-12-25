/**
 * Job Queue Manager for RWOS
 *
 * Handles job enqueueing, dequeueing, and status tracking.
 * Uses Redis ZSET for priority queue and HASH for job metadata.
 */

import { Effect } from "effect";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { type JobData, type JobOutput, RWOS_CONFIG, RedisKeys, deserializeJobData, serializeJobData } from "../redis/schema";

// =============================================================================
// Job Manager Error Types
// =============================================================================

export type JobManagerError =
	| RedisError
	| { readonly _tag: "JobNotFound"; readonly jobId: string }
	| { readonly _tag: "InvalidJobData"; readonly reason: string };

// =============================================================================
// Job Queue Operations
// =============================================================================

/**
 * Enqueue a new job. Adds to pending queue and stores job metadata.
 */
export const enqueueJob = (
	job: Omit<JobData, "status" | "timestamps" | "retries"> & {
		timestamps?: Partial<JobData["timestamps"]>;
	},
): Effect.Effect<JobData, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		const fullJob: JobData = {
			...job,
			status: "pending",
			timestamps: {
				createdAt: job.timestamps?.createdAt || now,
				queuedAt: now,
				...job.timestamps,
			},
			retries: 0,
		};

		const score = now;
		const serialized = serializeJobData(fullJob);

		yield* Effect.tryPromise({
			try: async () => {
				const pipe = client.pipeline();
				pipe.zadd(RedisKeys.jobsPending, { score, member: job.jobId });
				pipe.hset(RedisKeys.jobStatus(job.jobId), serialized);
				pipe.expire(RedisKeys.jobStatus(job.jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
				await pipe.exec();
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return fullJob;
	});

/**
 * Atomically pop a job from the queue and mark it as running.
 */
export const popJob = (machineId: string): Effect.Effect<JobData | null, JobManagerError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

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

		const jobId = typeof popped[0] === "object" && "member" in popped[0] ? (popped[0] as { member: string }).member : (popped[0] as string);

		const now = Date.now();

		const jobData = yield* Effect.tryPromise({
			try: async () => {
				const pipe = client.pipeline();
				pipe.hgetall(RedisKeys.jobStatus(jobId));
				pipe.hset(RedisKeys.jobStatus(jobId), {
					status: "running",
					machineId,
					startedAt: String(now),
				});
				pipe.hset(RedisKeys.jobsActive, { [jobId]: machineId });
				const results = await pipe.exec();
				return results[0] as Record<string, string> | null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!jobData) {
			return yield* Effect.fail({ _tag: "JobNotFound" as const, jobId });
		}

		const job = deserializeJobData(jobData);
		if (!job) {
			return yield* Effect.fail({
				_tag: "InvalidJobData" as const,
				reason: `Failed to deserialize job ${jobId}`,
			});
		}

		return {
			...job,
			status: "running" as const,
			machineId,
			timestamps: {
				...job.timestamps,
				startedAt: now,
			},
		};
	});

/**
 * Mark a job as completed.
 */
export const completeJob = (
	jobId: string,
	result?: { outputs?: JobOutput[]; duration?: number },
): Effect.Effect<void, RedisError, RedisService> =>
	redisEffect(async (client) => {
		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), {
			status: "completed",
			completedAt: String(Date.now()),
			...(result?.outputs && { outputs: JSON.stringify(result.outputs) }),
			...(result?.duration && { duration: String(result.duration) }),
		});
		pipe.hdel(RedisKeys.jobsActive, jobId);
		await pipe.exec();
	});

/**
 * Mark a job as failed.
 */
export const failJob = (jobId: string, error: string): Effect.Effect<void, RedisError, RedisService> =>
	redisEffect(async (client) => {
		const pipe = client.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), {
			status: "failed",
			completedAt: String(Date.now()),
			error,
		});
		pipe.hdel(RedisKeys.jobsActive, jobId);
		await pipe.exec();
	});

/**
 * Requeue a job (for retry after failure).
 */
export const requeueJob = (jobId: string): Effect.Effect<boolean, JobManagerError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

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
		if (retries >= RWOS_CONFIG.MAX_JOB_RETRIES) {
			yield* failJob(jobId, "Max retries exceeded");
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
 * Get job status by ID.
 */
export const getJobStatus = (jobId: string): Effect.Effect<JobData | null, RedisError, RedisService> =>
	Effect.gen(function* () {
		const data = yield* redisEffect((client) => client.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId)));
		return data ? deserializeJobData(data) : null;
	});

/**
 * Get pending queue length.
 */
export const getPendingCount = (): Effect.Effect<number, RedisError, RedisService> =>
	redisEffect((client) => client.zcard(RedisKeys.jobsPending));

/**
 * Get all active jobs.
 */
export const getActiveJobs = (): Effect.Effect<Record<string, string>, RedisError, RedisService> =>
	redisEffect(async (client) => {
		const result = await client.hgetall<Record<string, string>>(RedisKeys.jobsActive);
		return result || {};
	});
