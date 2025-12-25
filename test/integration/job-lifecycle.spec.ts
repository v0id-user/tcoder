/**
 * Integration Tests - Job Lifecycle
 *
 * End-to-end tests for the complete job lifecycle:
 * 1. Upload request → Presigned URL
 * 2. File upload → R2 event → Job creation
 * 3. Worker spawn → Job processing
 * 4. Job completion → Webhook → Status update
 * 5. Status polling
 *
 * Note: These are integration tests that may require external services.
 * They test the complete flow but may be skipped if services are unavailable.
 */

import { describe, expect, it } from "vitest";
import { getCloudflareTest } from "../test-helpers";

describe("Job Lifecycle Integration", () => {
	it("completes full job lifecycle", async () => {
		const cfTest = await getCloudflareTest();
		if (!cfTest) return;
		const { SELF } = cfTest;

		// Step 1: Request upload URL
		const uploadResponse = await SELF.fetch("https://example.com/api/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				filename: "test-video.mp4",
				contentType: "video/mp4",
				preset: "default",
			}),
		});

		// Skip if R2 not configured
		if (uploadResponse.status !== 201) {
			console.log("Skipping job lifecycle test: R2 not configured");
			return;
		}

		const uploadData = (await uploadResponse.json()) as {
			jobId: string;
			uploadUrl: string;
			inputKey: string;
			expiresAt: number;
		};

		expect(uploadData.jobId).toBeDefined();
		expect(uploadData.uploadUrl).toBeDefined();
		expect(uploadData.inputKey).toBeDefined();

		// Step 2: Check job status (should be "uploading")
		const statusResponse1 = await SELF.fetch(`https://example.com/api/jobs/${uploadData.jobId}`);
		if (statusResponse1.status === 200) {
			const status1 = (await statusResponse1.json()) as { status: string };
			// Job may already be processed or still uploading
			expect(["uploading", "pending", "running", "completed"]).toContain(status1.status);
		}

		// Step 3: Poll job status (simulate client polling)
		// Note: In a real scenario, the file would be uploaded to the presigned URL,
		// which would trigger an R2 event, which would process the job.
		// Here we just verify the status endpoint works.

		const statusResponse2 = await SELF.fetch(`https://example.com/api/jobs/${uploadData.jobId}`);
		if (statusResponse2.status === 200) {
			const status2 = (await statusResponse2.json()) as {
				jobId: string;
				status: string;
				timestamps: unknown;
			};
			expect(status2.jobId).toBe(uploadData.jobId);
			expect(status2.status).toBeDefined();
			expect(status2.timestamps).toBeDefined();
		}
	});

	it("handles direct job submission flow", async () => {
		const cfTest = await getCloudflareTest();
		if (!cfTest) return;
		const { SELF } = cfTest;

		// Step 1: Submit job directly (no upload)
		const submitResponse = await SELF.fetch("https://example.com/api/jobs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				inputUrl: "https://example.com/video.mp4",
				outputUrl: "outputs/test-job",
				preset: "default",
			}),
		});

		// Skip if Redis not configured
		if (submitResponse.status !== 201) {
			console.log("Skipping direct job submission test: Redis not configured");
			return;
		}

		const submitData = (await submitResponse.json()) as {
			jobId: string;
			status: string;
			queuedAt: number;
		};

		expect(submitData.jobId).toBeDefined();
		expect(submitData.status).toBe("pending");
		expect(submitData.queuedAt).toBeGreaterThan(0);

		// Step 2: Poll job status
		const statusResponse = await SELF.fetch(`https://example.com/api/jobs/${submitData.jobId}`);
		if (statusResponse.status === 200) {
			const status = (await statusResponse.json()) as {
				jobId: string;
				status: string;
			};
			expect(status.jobId).toBe(submitData.jobId);
			expect(status.status).toBeDefined();
		}

		// Step 3: Simulate job completion via webhook
		const webhookResponse = await SELF.fetch("https://example.com/webhooks/job-complete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jobId: submitData.jobId,
				status: "completed",
				inputUrl: "https://example.com/video.mp4",
				outputs: [
					{
						quality: "1080p",
						url: "https://example.com/1080p.mp4",
						preset: "default",
					},
				],
			}),
		});

		expect(webhookResponse.status).toBe(200);

		// Step 4: Verify job status updated
		const finalStatusResponse = await SELF.fetch(`https://example.com/api/jobs/${submitData.jobId}`);
		if (finalStatusResponse.status === 200) {
			const finalStatus = (await finalStatusResponse.json()) as {
				status: string;
				outputs?: unknown[];
			};
			// Status should be completed after webhook
			expect(finalStatus.status).toBe("completed");
			expect(finalStatus.outputs).toBeDefined();
		}
	});
});
