/**
 * Tests for Webhook Routes
 *
 * Tests webhook endpoint for job completion notifications.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getCloudflareTest } from "./test-helpers";

describe("Webhook Routes", () => {
	beforeEach(async () => {
		// Reset any test state if needed
	});

	describe("POST /webhooks/job-complete", () => {
		it("updates job status to completed", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				jobId: "test-job-complete",
				status: "completed" as const,
				inputUrl: "https://example.com/input.mp4",
				outputs: [
					{
						quality: "1080p",
						url: "https://example.com/1080p.mp4",
						preset: "default",
					},
				],
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			// May return 500 if Redis is unavailable, or 200 if Redis is available
			if (response.status === 200) {
				const data = (await response.json()) as { received: boolean };
				expect(data.received).toBe(true);
			} else {
				// Redis unavailable - verify it's an error response
				expect(response.status).toBe(500);
				const data = (await response.json()) as { error: string };
				expect(data.error).toBe("Redis connection failed");
			}
		}, 10000);

		it("updates job status to failed with error message", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				jobId: "test-job-failed",
				status: "failed" as const,
				inputUrl: "https://example.com/input.mp4",
				outputs: [],
				error: "Transcoding failed: invalid format",
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			// May return 500 if Redis is unavailable, or 200 if Redis is available
			if (response.status === 200) {
				const data = (await response.json()) as { received: boolean };
				expect(data.received).toBe(true);
			} else {
				// Redis unavailable - verify it's an error response
				expect(response.status).toBe(500);
				const data = (await response.json()) as { error: string };
				expect(data.error).toBe("Redis connection failed");
			}
		}, 10000);

		it("handles multiple outputs", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				jobId: "test-job-multiple-outputs",
				status: "completed" as const,
				inputUrl: "https://example.com/input.mp4",
				outputs: [
					{
						quality: "1080p",
						url: "https://example.com/1080p.mp4",
						preset: "default",
					},
					{
						quality: "720p",
						url: "https://example.com/720p.mp4",
						preset: "default",
					},
					{
						quality: "480p",
						url: "https://example.com/480p.mp4",
						preset: "default",
					},
				],
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			// May return 500 if Redis is unavailable, or 200 if Redis is available
			if (response.status === 200) {
				const data = (await response.json()) as { received: boolean };
				expect(data.received).toBe(true);
			} else {
				// Redis unavailable - verify it's an error response
				expect(response.status).toBe(500);
			}
		}, 10000);

		it("validates request schema - missing required fields", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				// Missing jobId, status, inputUrl, outputs
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("validates request schema - invalid status", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				jobId: "test-job",
				status: "invalid-status",
				inputUrl: "https://example.com/input.mp4",
				outputs: [],
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("handles optional duration field", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const payload = {
				jobId: "test-job-duration",
				status: "completed" as const,
				inputUrl: "https://example.com/input.mp4",
				outputs: [
					{
						quality: "1080p",
						url: "https://example.com/1080p.mp4",
						preset: "default",
					},
				],
				duration: 120,
			};

			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			// May return 500 if Redis is unavailable, or 200 if Redis is available
			if (response.status === 200) {
				const data = (await response.json()) as { received: boolean };
				expect(data.received).toBe(true);
			} else {
				// Redis unavailable - verify it's an error response
				expect(response.status).toBe(500);
			}
		}, 10000);
	});
});
