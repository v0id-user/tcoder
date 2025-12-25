/**
 * Tests for R2 Event Handling
 *
 * Tests R2 event processing, job creation/updates, and recovery logic.
 * Note: These tests focus on the recovery function which can be tested in isolation.
 * Full event handler tests would require integration testing with real Redis.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { type RecoveryEnv, recoverUploadingJob } from "../src/r2/events";
import { RedisKeys, serializeJobData } from "../src/redis/schema";
import { MockR2Bucket } from "./mocks/r2.mock";
import { MockRedis, createTestJobData } from "./test-helpers";

describe("R2 Events - Recovery", () => {
	let mockRedis: MockRedis;
	let mockR2Bucket: MockR2Bucket;

	beforeEach(() => {
		mockRedis = new MockRedis();
		mockR2Bucket = new MockR2Bucket();
	});

	describe("recoverUploadingJob", () => {
		it("recovers job when file exists in R2", async () => {
			const jobId = "test-job-recover";
			const inputKey = `inputs/${jobId}/video.mp4`;

			// Setup: job exists in uploading state
			const job = createTestJobData({
				jobId,
				status: "uploading",
				inputKey,
			});
			await mockRedis.hset(RedisKeys.jobStatus(jobId), serializeJobData(job));

			// Setup: file exists in R2
			await mockR2Bucket.put(inputKey, new Blob(["test data"]));

			const env: RecoveryEnv = {
				UPSTASH_REDIS_REST_URL: "https://redis.example.com",
				UPSTASH_REDIS_REST_TOKEN: "token",
				FLY_API_TOKEN: "token",
				FLY_APP_NAME: "test-app",
				FLY_REGION: "iad",
				WEBHOOK_BASE_URL: "https://example.com",
				R2_ACCOUNT_ID: "test-account",
				R2_INPUT_BUCKET_NAME: "tcoder-input",
				INPUT_BUCKET: mockR2Bucket as unknown as R2Bucket,
			};

			const result = await recoverUploadingJob(
				mockRedis as unknown as ReturnType<typeof import("@upstash/redis/cloudflare").Redis.fromEnv>,
				env,
				jobId,
				inputKey,
			);

			expect(result).toBe(true);

			// Verify job status updated to pending
			const updatedJob = await mockRedis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
			if (updatedJob) {
				expect(updatedJob.status).toBe("pending");
			}
		});

		it("returns false when file does not exist", async () => {
			const jobId = "test-job-not-found";
			const inputKey = `inputs/${jobId}/video.mp4`;

			// Setup: job exists in uploading state
			const job = createTestJobData({
				jobId,
				status: "uploading",
				inputKey,
			});
			await mockRedis.hset(RedisKeys.jobStatus(jobId), serializeJobData(job));

			// File does not exist in R2

			const env: RecoveryEnv = {
				UPSTASH_REDIS_REST_URL: "https://redis.example.com",
				UPSTASH_REDIS_REST_TOKEN: "token",
				FLY_API_TOKEN: "token",
				FLY_APP_NAME: "test-app",
				FLY_REGION: "iad",
				WEBHOOK_BASE_URL: "https://example.com",
				R2_ACCOUNT_ID: "test-account",
				R2_INPUT_BUCKET_NAME: "tcoder-input",
				INPUT_BUCKET: mockR2Bucket as unknown as R2Bucket,
			};

			const result = await recoverUploadingJob(
				mockRedis as unknown as ReturnType<typeof import("@upstash/redis/cloudflare").Redis.fromEnv>,
				env,
				jobId,
				inputKey,
			);

			expect(result).toBe(false);
		});

		it("returns false when job not in uploading state", async () => {
			const jobId = "test-job-already-pending";
			const inputKey = `inputs/${jobId}/video.mp4`;

			// Setup: job already in pending state
			const job = createTestJobData({
				jobId,
				status: "pending",
				inputKey,
			});
			await mockRedis.hset(RedisKeys.jobStatus(jobId), serializeJobData(job));

			await mockR2Bucket.put(inputKey, new Blob(["test data"]));

			const env: RecoveryEnv = {
				UPSTASH_REDIS_REST_URL: "https://redis.example.com",
				UPSTASH_REDIS_REST_TOKEN: "token",
				FLY_API_TOKEN: "token",
				FLY_APP_NAME: "test-app",
				FLY_REGION: "iad",
				WEBHOOK_BASE_URL: "https://example.com",
				R2_ACCOUNT_ID: "test-account",
				R2_INPUT_BUCKET_NAME: "tcoder-input",
				INPUT_BUCKET: mockR2Bucket as unknown as R2Bucket,
			};

			const result = await recoverUploadingJob(
				mockRedis as unknown as ReturnType<typeof import("@upstash/redis/cloudflare").Redis.fromEnv>,
				env,
				jobId,
				inputKey,
			);

			expect(result).toBe(false);
		});
	});
});
