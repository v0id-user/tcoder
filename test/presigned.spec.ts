import { describe, expect, it } from "vitest";
import { generateInputKey, generateOutputKey, extractJobIdFromKey } from "../src/r2/presigned";

describe("R2 Key Generation", () => {
	describe("generateInputKey", () => {
		it("generates correct input key format", () => {
			const key = generateInputKey("job-123", "video.mp4");
			expect(key).toBe("inputs/job-123/video.mp4");
		});

		it("sanitizes filename with special characters", () => {
			const key = generateInputKey("job-123", "video file (1).mp4");
			expect(key).toBe("inputs/job-123/video_file__1_.mp4");
		});

		it("handles filenames with spaces", () => {
			const key = generateInputKey("job-123", "my video file.mp4");
			expect(key).toBe("inputs/job-123/my_video_file.mp4");
		});

		it("preserves allowed characters", () => {
			const key = generateInputKey("job-123", "video_file-name.123.mp4");
			expect(key).toBe("inputs/job-123/video_file-name.123.mp4");
		});
	});

	describe("generateOutputKey", () => {
		it("generates correct output key format", () => {
			const key = generateOutputKey("job-123", "1080p");
			expect(key).toBe("outputs/job-123/1080p.mp4");
		});

		it("allows custom extension", () => {
			const key = generateOutputKey("job-123", "1080p", "m3u8");
			expect(key).toBe("outputs/job-123/1080p.m3u8");
		});
	});

	describe("extractJobIdFromKey", () => {
		it("extracts job ID from input key", () => {
			const jobId = extractJobIdFromKey("inputs/job-123/video.mp4");
			expect(jobId).toBe("job-123");
		});

		it("extracts job ID from output key", () => {
			const jobId = extractJobIdFromKey("outputs/job-456/1080p.mp4");
			expect(jobId).toBe("job-456");
		});

		it("returns null for invalid format", () => {
			const jobId = extractJobIdFromKey("invalid/key/format");
			expect(jobId).toBeNull();
		});

		it("returns null for empty string", () => {
			const jobId = extractJobIdFromKey("");
			expect(jobId).toBeNull();
		});
	});
});
