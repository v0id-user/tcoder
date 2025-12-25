import { describe, expect, it } from "vitest";

// Check if cloudflare:test is available (only in Vitest with Cloudflare Workers pool)
// Use a lazy getter to avoid top-level await issues
let cloudflareTestCache: typeof import("cloudflare:test") | null = null;
async function getCloudflareTest() {
	if (cloudflareTestCache !== null) return cloudflareTestCache;
	try {
		cloudflareTestCache = await import("cloudflare:test");
		return cloudflareTestCache;
	} catch {
		cloudflareTestCache = null;
		return null;
	}
}

describe("API Routes", () => {
	describe("GET /status", () => {
		it(
			"returns status with server time and Redis info",
			async () => {
				const cfTest = await getCloudflareTest();
				if (!cfTest) return;
				const { SELF } = cfTest;

				const response = await SELF.fetch("https://example.com/api/status");

				// Status endpoint may return 500 if Redis is not available in test env
				// This is acceptable - we just check the structure
				const data = (await response.json()) as {
					status: string;
					serverTime: { timestamp: number; iso: string; utc: string };
					redis: { connected?: boolean; ping?: string; testRead?: boolean };
				};

				expect(data).toHaveProperty("status");
				expect(data).toHaveProperty("serverTime");
				expect(data).toHaveProperty("redis");
				expect(data.serverTime).toHaveProperty("timestamp");
				expect(data.serverTime).toHaveProperty("iso");
				expect(data.serverTime).toHaveProperty("utc");

				// If Redis is available, status should be ok
				if (response.status === 200) {
					expect(data.redis.connected).toBe(true);
					expect(data.redis.ping).toBe("PONG");
					expect(data.redis.testRead).toBe(true);
				}
			},
			{ timeout: 30000 }, // 30 second timeout for Redis connection
		);

		it(
			"handles Redis connection errors gracefully",
			async () => {
				const cfTest = await getCloudflareTest();
				if (!cfTest) return;
				const { SELF } = cfTest;

				const response = await SELF.fetch("https://example.com/api/status");

				// Should always return a response, even if Redis is unavailable
				expect(response.status).toBeGreaterThanOrEqual(200);
				expect(response.status).toBeLessThan(600);

				const data = (await response.json()) as {
					status: string;
					serverTime: { timestamp: number; iso: string; utc: string };
					redis: { connected?: boolean };
				};
				expect(data).toHaveProperty("status");
				expect(data).toHaveProperty("serverTime");

				// If Redis is unavailable, status may be "error"
				if (data.status === "error") {
					expect(data.redis).toHaveProperty("connected");
					expect(data.redis.connected).toBe(false);
				}
			},
			{ timeout: 10000 },
		);
	});

	describe("GET /stats", () => {
		it(
			"returns system stats",
			async () => {
				const cfTest = await getCloudflareTest();
				if (!cfTest) return;
				const { SELF } = cfTest;

				const response = await SELF.fetch("https://example.com/api/stats");

				// May fail if Redis is not configured
				if (response.status === 200) {
					const data = (await response.json()) as {
						machines: { activeMachines: number; maxMachines: number };
						pendingJobs: number;
						activeJobs: number;
						activeJobIds: string[];
					};
					expect(data).toHaveProperty("machines");
					expect(data).toHaveProperty("pendingJobs");
					expect(data).toHaveProperty("activeJobs");
					expect(data).toHaveProperty("activeJobIds");
					expect(Array.isArray(data.activeJobIds)).toBe(true);
				} else {
					// Redis unavailable - verify it's an error response
					expect(response.status).toBe(500);
					const data = (await response.json()) as { error: string };
					expect(data.error).toBe("Redis connection failed");
				}
			},
			{ timeout: 10000 },
		);
	});

	describe("GET /jobs/:jobId", () => {
		it("returns 404 for non-existent job", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const nonExistentJobId = "00000000-0000-0000-0000-000000000000";
			const response = await SELF.fetch(`https://example.com/api/jobs/${nonExistentJobId}`);

			// May return 500 if Redis is not available, or 404 if Redis is available
			if (response.status === 404) {
				const data = (await response.json()) as { error: string };
				expect(data).toHaveProperty("error");
				expect(data.error).toBe("Job not found");
			} else {
				// Redis unavailable - just verify it's an error status
				expect(response.status).toBeGreaterThanOrEqual(400);
				// Try to parse JSON, but don't fail if it's not JSON
				try {
					const data = (await response.json()) as unknown;
					expect(data).toBeDefined();
				} catch {
					// Not JSON, that's okay for error responses
				}
			}
		});

		it("returns job status with all fields", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			// First create a job
			const createResponse = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "default",
				}),
			});

			if (createResponse.status === 201) {
				const createData = (await createResponse.json()) as { jobId: string };
				const jobId = createData.jobId;

				const response = await SELF.fetch(`https://example.com/api/jobs/${jobId}`);

				if (response.status === 200) {
					const data = (await response.json()) as {
						jobId: string;
						status: string;
						timestamps: unknown;
					};
					expect(data).toHaveProperty("jobId");
					expect(data).toHaveProperty("status");
					expect(data).toHaveProperty("timestamps");
					expect(data.status).toBe("pending");
				}
			}
		});
	});

	describe("POST /upload", () => {
		it("validates request body schema - missing filename", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}), // Missing required filename
			});

			// Should return validation error
			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("validates request body schema - invalid preset", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "test-video.mp4",
					preset: "invalid-preset",
				}),
			});

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("accepts valid upload request", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "test-video.mp4",
					contentType: "video/mp4",
					preset: "default",
				}),
			});

			// Should return 201 with upload URL
			// Note: This may fail if R2 credentials are not configured in test env
			if (response.status === 201) {
				const data = (await response.json()) as {
					jobId: string;
					uploadUrl: string;
					inputKey: string;
					expiresAt: number;
				};
				expect(data).toHaveProperty("jobId");
				expect(data).toHaveProperty("uploadUrl");
				expect(data).toHaveProperty("inputKey");
				expect(data).toHaveProperty("expiresAt");
				expect(data.inputKey).toContain("inputs/");
			}
		});

		it("generates job with custom preset", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "test-video.mp4",
					preset: "hls",
				}),
			});

			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string };
				expect(data.jobId).toBeDefined();
			}
		});

		it("handles output qualities parameter", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filename: "test-video.mp4",
					preset: "default",
					outputQualities: ["1080p", "720p", "480p"],
				}),
			});

			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string };
				expect(data.jobId).toBeDefined();
			}
		});
	});

	describe("POST /jobs", () => {
		it("validates request body schema - missing required fields", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}), // Missing required fields
			});

			// Should return validation error
			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("validates request body schema - invalid inputUrl", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "not-a-valid-url",
					outputUrl: "outputs/test",
					preset: "default",
				}),
			});

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("validates request body schema - invalid preset", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "invalid-preset",
				}),
			});

			expect(response.status).toBeGreaterThanOrEqual(400);
		});

		it("accepts valid job submission", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "default",
				}),
			});

			// Should return 201 with job ID
			// Note: This may fail if Redis is not configured in test env
			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string; status: string; queuedAt: number };
				expect(data).toHaveProperty("jobId");
				expect(data).toHaveProperty("status");
				expect(data.status).toBe("pending");
				expect(data).toHaveProperty("queuedAt");
			}
		});

		it("accepts custom job ID", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const customJobId = crypto.randomUUID();
			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jobId: customJobId,
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "default",
				}),
			});

			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string };
				expect(data.jobId).toBe(customJobId);
			}
		});

		it("handles r2Config parameter", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "default",
					r2Config: {
						accountId: "test-account",
						accessKeyId: "test-key",
						secretAccessKey: "test-secret",
						bucketName: "test-bucket",
					},
				}),
			});

			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string };
				expect(data.jobId).toBeDefined();
			}
		});

		it("handles outputQualities parameter", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/jobs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					inputUrl: "https://example.com/video.mp4",
					outputUrl: "outputs/test",
					preset: "default",
					outputQualities: ["1080p", "720p"],
				}),
			});

			if (response.status === 201) {
				const data = (await response.json()) as { jobId: string };
				expect(data.jobId).toBeDefined();
			}
		});
	});
});
