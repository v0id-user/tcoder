import { describe, expect, it } from "vitest";
import {
	type JobData,
	serializeJobData,
	deserializeJobData,
	serializeMachinePoolEntry,
	deserializeMachinePoolEntry,
} from "../src/redis/schema";

describe("Schema Serialization", () => {
	describe("JobData", () => {
		it("serializes and deserializes job data correctly", () => {
			const job: JobData = {
				jobId: "test-job-123",
				status: "pending",
				machineId: "machine-456",
				inputKey: "inputs/test-job-123/video.mp4",
				outputUrl: "outputs/test-job-123",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
				filename: "video.mp4",
				contentType: "video/mp4",
				timestamps: {
					createdAt: 1000,
					queuedAt: 2000,
					startedAt: 3000,
				},
				retries: 1,
			};

			const serialized = serializeJobData(job);
			const deserialized = deserializeJobData(serialized);

			expect(deserialized).not.toBeNull();
			expect(deserialized?.jobId).toBe(job.jobId);
			expect(deserialized?.status).toBe(job.status);
			expect(deserialized?.machineId).toBe(job.machineId);
			expect(deserialized?.inputKey).toBe(job.inputKey);
			expect(deserialized?.preset).toBe(job.preset);
			expect(deserialized?.retries).toBe(job.retries);
			expect(deserialized?.timestamps.createdAt).toBe(1000);
			expect(deserialized?.timestamps.queuedAt).toBe(2000);
			expect(deserialized?.timestamps.startedAt).toBe(3000);
		});

		it("handles optional fields correctly", () => {
			const job: JobData = {
				jobId: "minimal-job",
				status: "uploading",
				inputKey: "",
				outputUrl: "outputs/minimal-job",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
				timestamps: {
					createdAt: Date.now(),
				},
				retries: 0,
			};

			const serialized = serializeJobData(job);
			const deserialized = deserializeJobData(serialized);

			expect(deserialized).not.toBeNull();
			expect(deserialized?.jobId).toBe(job.jobId);
			expect(deserialized?.status).toBe(job.status);
			expect(deserialized?.machineId).toBeUndefined();
			expect(deserialized?.filename).toBeUndefined();
		});

		it("handles outputs array", () => {
			const job: JobData = {
				jobId: "job-with-outputs",
				status: "completed",
				inputKey: "inputs/job-with-outputs/video.mp4",
				outputUrl: "outputs/job-with-outputs",
				preset: "default",
				webhookUrl: "https://example.com/webhook",
				outputs: [
					{ quality: "1080p", url: "https://example.com/1080p.mp4" },
					{ quality: "720p", url: "https://example.com/720p.mp4" },
				],
				timestamps: {
					createdAt: Date.now(),
					completedAt: Date.now(),
				},
				retries: 0,
			};

			const serialized = serializeJobData(job);
			const deserialized = deserializeJobData(serialized);

			expect(deserialized?.outputs).toHaveLength(2);
			expect(deserialized?.outputs?.[0].quality).toBe("1080p");
			expect(deserialized?.outputs?.[1].quality).toBe("720p");
		});

		it("returns null for invalid data", () => {
			const result = deserializeJobData({});
			expect(result).toBeNull();
		});
	});

	describe("MachinePoolEntry", () => {
		it("serializes and deserializes machine pool entry correctly", () => {
			const entry = {
				machineId: "machine-123",
				state: "running" as const,
				lastActiveAt: 1000,
				createdAt: 500,
			};

			const serialized = serializeMachinePoolEntry(entry);
			const deserialized = deserializeMachinePoolEntry(entry.machineId, serialized);

			expect(deserialized).not.toBeNull();
			expect(deserialized?.machineId).toBe(entry.machineId);
			expect(deserialized?.state).toBe(entry.state);
			expect(deserialized?.lastActiveAt).toBe(entry.lastActiveAt);
			expect(deserialized?.createdAt).toBe(entry.createdAt);
		});

		it("handles idle state", () => {
			const entry = {
				machineId: "machine-idle",
				state: "idle" as const,
				lastActiveAt: Date.now(),
				createdAt: Date.now() - 10000,
			};

			const serialized = serializeMachinePoolEntry(entry);
			const deserialized = deserializeMachinePoolEntry(entry.machineId, serialized);

			expect(deserialized?.state).toBe("idle");
		});

		it("returns null for null input", () => {
			const result = deserializeMachinePoolEntry("machine-123", null);
			expect(result).toBeNull();
		});

		it("returns null for invalid JSON", () => {
			const result = deserializeMachinePoolEntry("machine-123", "invalid json");
			expect(result).toBeNull();
		});
	});
});
