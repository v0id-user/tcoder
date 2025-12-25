/**
 * Tests for Job Manager
 *
 * Tests job queue operations: enqueue, pop, complete, fail, requeue, and status queries.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	completeJob,
	enqueueJob,
	failJob,
	getActiveJobs,
	getJobStatus,
	getPendingCount,
	popJob,
	requeueJob,
} from "../src/orchestration/job-manager";
import { RWOS_CONFIG, RedisKeys, deserializeJobData, serializeJobData } from "../src/redis/schema";
import {
	MockRedis,
	createMockRedisLayer,
	createTestJobData,
	extractErrorFromExit,
	runWithMockRedis,
	runWithMockRedisExit,
} from "./test-helpers";

describe("Job Manager", () => {
	let mockRedis: MockRedis;

	beforeEach(() => {
		mockRedis = new MockRedis();
	});

	describe("enqueueJob", () => {
		it("enqueues job with correct status and timestamps", async () => {
			const jobInput = {
				jobId: "test-job-1",
				inputKey: "inputs/test-job-1/video.mp4",
				outputUrl: "outputs/test-job-1",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
			};

			const result = await runWithMockRedis(enqueueJob(jobInput), mockRedis);

			expect(result.status).toBe("pending");
			expect(result.jobId).toBe(jobInput.jobId);
			expect(result.timestamps.createdAt).toBeGreaterThan(0);
			expect(result.timestamps.queuedAt).toBeGreaterThan(0);
			expect(result.retries).toBe(0);

			// Verify job is in pending queue
			const pendingCount = await mockRedis.zcard(RedisKeys.jobsPending);
			expect(pendingCount).toBe(1);

			// Verify job data is stored
			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobInput.jobId));
			expect(stored).not.toBeNull();
			if (stored) {
				const job = deserializeJobData(stored);
				expect(job?.status).toBe("pending");
			}
		});

		it("preserves custom timestamps", async () => {
			const customCreatedAt = Date.now() - 10000;
			const jobInput = {
				jobId: "test-job-2",
				inputKey: "inputs/test-job-2/video.mp4",
				outputUrl: "outputs/test-job-2",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
				timestamps: {
					createdAt: customCreatedAt,
				},
			};

			const result = await runWithMockRedis(enqueueJob(jobInput), mockRedis);

			expect(result.timestamps.createdAt).toBe(customCreatedAt);
			expect(result.timestamps.queuedAt).toBeGreaterThan(customCreatedAt);
		});

		it("sets expiration on job status", async () => {
			const jobInput = {
				jobId: "test-job-3",
				inputKey: "inputs/test-job-3/video.mp4",
				outputUrl: "outputs/test-job-3",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
			};

			await runWithMockRedis(enqueueJob(jobInput), mockRedis);

			// Expiration is set via pipeline, so we can't easily test it with our mock
			// But we can verify the job was stored
			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobInput.jobId));
			expect(stored).not.toBeNull();
		});
	});

	describe("popJob", () => {
		it("returns null when queue is empty", async () => {
			const result = await runWithMockRedis(popJob("machine-1"), mockRedis);
			expect(result).toBeNull();
		});

		it("pops job from queue and marks as running", async () => {
			const job = createTestJobData({
				jobId: "test-job-pop",
				status: "pending",
			});

			// Enqueue job
			await mockRedis.zadd(RedisKeys.jobsPending, { score: Date.now(), member: job.jobId });
			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));

			const machineId = "machine-123";
			const result = await runWithMockRedis(popJob(machineId), mockRedis);

			expect(result).not.toBeNull();
			if (result) {
				expect(result.jobId).toBe(job.jobId);
				expect(result.status).toBe("running");
				expect(result.machineId).toBe(machineId);
				expect(result.timestamps.startedAt).toBeGreaterThan(0);
			}

			// Verify job is removed from pending queue
			const pendingCount = await mockRedis.zcard(RedisKeys.jobsPending);
			expect(pendingCount).toBe(0);

			// Verify job is in active jobs
			const activeJobs = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobsActive);
			expect(activeJobs?.[job.jobId]).toBe(machineId);

			// Verify job status updated
			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			if (stored) {
				expect(stored.status).toBe("running");
				expect(stored.machineId).toBe(machineId);
			}
		});

		it("fails when job data not found", async () => {
			// Add to queue but don't add job data
			await mockRedis.zadd(RedisKeys.jobsPending, { score: Date.now(), member: "missing-job" });

			const exit = await runWithMockRedisExit(popJob("machine-1"), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("JobNotFound");
				if ("jobId" in error) {
					expect(error.jobId).toBe("missing-job");
				}
			}
		});

		it("fails when job data is invalid", async () => {
			const jobId = "invalid-job";
			await mockRedis.zadd(RedisKeys.jobsPending, { score: Date.now(), member: jobId });
			await mockRedis.hset(RedisKeys.jobStatus(jobId), { invalid: "data" });

			const exit = await runWithMockRedisExit(popJob("machine-1"), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("InvalidJobData");
			}
		});
	});

	describe("completeJob", () => {
		it("marks job as completed with outputs", async () => {
			const job = createTestJobData({
				jobId: "test-job-complete",
				status: "running",
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));
			await mockRedis.hset(RedisKeys.jobsActive, { [job.jobId]: "machine-1" });

			const outputs = [
				{ quality: "1080p", url: "https://example.com/1080p.mp4" },
				{ quality: "720p", url: "https://example.com/720p.mp4" },
			];

			await runWithMockRedis(completeJob(job.jobId, { outputs, duration: 120 }), mockRedis);

			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			expect(stored?.status).toBe("completed");
			expect(stored?.completedAt).toBeDefined();
			expect(stored?.outputs).toBeDefined();
			expect(stored?.duration).toBe("120");

			// Verify job removed from active jobs
			const activeJobs = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobsActive);
			expect(activeJobs?.[job.jobId]).toBeUndefined();
		});

		it("marks job as completed without outputs", async () => {
			const job = createTestJobData({
				jobId: "test-job-complete-simple",
				status: "running",
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));
			await mockRedis.hset(RedisKeys.jobsActive, { [job.jobId]: "machine-1" });

			await runWithMockRedis(completeJob(job.jobId), mockRedis);

			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			expect(stored?.status).toBe("completed");
			expect(stored?.completedAt).toBeDefined();
		});
	});

	describe("failJob", () => {
		it("marks job as failed with error message", async () => {
			const job = createTestJobData({
				jobId: "test-job-fail",
				status: "running",
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));
			await mockRedis.hset(RedisKeys.jobsActive, { [job.jobId]: "machine-1" });

			const errorMessage = "Transcoding failed: invalid format";
			await runWithMockRedis(failJob(job.jobId, errorMessage), mockRedis);

			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			expect(stored?.status).toBe("failed");
			expect(stored?.error).toBe(errorMessage);
			expect(stored?.completedAt).toBeDefined();

			// Verify job removed from active jobs
			const activeJobs = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobsActive);
			expect(activeJobs?.[job.jobId]).toBeUndefined();
		});
	});

	describe("requeueJob", () => {
		it("requeues job when retries available", async () => {
			const job = createTestJobData({
				jobId: "test-job-requeue",
				status: "failed",
				retries: 1,
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));
			await mockRedis.hset(RedisKeys.jobsActive, { [job.jobId]: "machine-1" });

			const result = await runWithMockRedis(requeueJob(job.jobId), mockRedis);

			expect(result).toBe(true);

			// Verify job is back in pending queue
			const pendingCount = await mockRedis.zcard(RedisKeys.jobsPending);
			expect(pendingCount).toBe(1);

			// Verify retry count incremented
			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			expect(stored?.status).toBe("pending");
			expect(stored?.retries).toBe("2");
			expect(stored?.machineId).toBe("");

			// Verify job removed from active jobs
			const activeJobs = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobsActive);
			expect(activeJobs?.[job.jobId]).toBeUndefined();
		});

		it("fails job when max retries exceeded", async () => {
			const job = createTestJobData({
				jobId: "test-job-max-retries",
				status: "failed",
				retries: RWOS_CONFIG.MAX_JOB_RETRIES,
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));

			const result = await runWithMockRedis(requeueJob(job.jobId), mockRedis);

			expect(result).toBe(false);

			// Verify job is marked as failed
			const stored = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(job.jobId));
			expect(stored?.status).toBe("failed");
			expect(stored?.error).toBe("Max retries exceeded");

			// Verify job not in pending queue
			const pendingCount = await mockRedis.zcard(RedisKeys.jobsPending);
			expect(pendingCount).toBe(0);
		});

		it("fails when job not found", async () => {
			const exit = await runWithMockRedisExit(requeueJob("non-existent-job"), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("JobNotFound");
			}
		});
	});

	describe("getJobStatus", () => {
		it("returns job data when found", async () => {
			const job = createTestJobData({
				jobId: "test-job-status",
			});

			await mockRedis.hset(RedisKeys.jobStatus(job.jobId), serializeJobData(job));

			const result = await runWithMockRedis(getJobStatus(job.jobId), mockRedis);

			expect(result).not.toBeNull();
			if (result) {
				expect(result.jobId).toBe(job.jobId);
				expect(result.status).toBe(job.status);
			}
		});

		it("returns null when job not found", async () => {
			const result = await runWithMockRedis(getJobStatus("non-existent-job"), mockRedis);
			expect(result).toBeNull();
		});
	});

	describe("getPendingCount", () => {
		it("returns 0 when queue is empty", async () => {
			const count = await runWithMockRedis(getPendingCount(), mockRedis);
			expect(count).toBe(0);
		});

		it("returns correct count for queued jobs", async () => {
			const jobs = ["job-1", "job-2", "job-3"];

			for (const jobId of jobs) {
				await mockRedis.zadd(RedisKeys.jobsPending, { score: Date.now(), member: jobId });
			}

			const count = await runWithMockRedis(getPendingCount(), mockRedis);
			expect(count).toBe(3);
		});
	});

	describe("getActiveJobs", () => {
		it("returns empty object when no active jobs", async () => {
			const result = await runWithMockRedis(getActiveJobs(), mockRedis);
			expect(result).toEqual({});
		});

		it("returns active jobs mapping", async () => {
			const activeJobs = {
				"job-1": "machine-1",
				"job-2": "machine-2",
				"job-3": "machine-1",
			};

			await mockRedis.hset(RedisKeys.jobsActive, activeJobs);

			const result = await runWithMockRedis(getActiveJobs(), mockRedis);
			expect(result).toEqual(activeJobs);
		});
	});
});
