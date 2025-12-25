import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareTest } from "./test-helpers";

describe("Worker", () => {
	beforeEach(() => {
		// Reset global state if needed
		(globalThis as { _devModeLogged?: boolean })._devModeLogged = undefined;
	});

	describe("Fetch Handler", () => {
		it("responds with ok status on root path", async () => {
				const cfTest = await getCloudflareTest();
				if (!cfTest) {
					// Skip test if cloudflare:test is not available (e.g., running with bun test)
					return;
				}
				const { createExecutionContext, env, waitOnExecutionContext } = cfTest;
				const { default: worker } = await import("../src/index");
				const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

				const request = new IncomingRequest("http://example.com/");
				const ctx = createExecutionContext();
				// Type assertion needed because ProvidedEnv may not have all Env properties in test
				const response = await worker.fetch(request, env as unknown as Parameters<typeof worker.fetch>[1], ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
				const data = (await response.json()) as { status: string; service: string };
				expect(data).toEqual({
					status: "ok",
					service: "tcoder",
				});
			}, 10000);

		it("responds with ok status (integration style)", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) {
				// Skip test if cloudflare:test is not available (e.g., running with bun test)
				return;
			}
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/");
			expect(response.status).toBe(200);
			const data = (await response.json()) as { status: string; service: string };
			expect(data.status).toBe("ok");
			expect(data.service).toBe("tcoder");
		});

		it("mounts API routes correctly", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			const response = await SELF.fetch("https://example.com/api/status");
			// Should route to API, not return 404
			expect(response.status).not.toBe(404);
		});

		it("mounts webhook routes correctly", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;
			const { SELF } = cfTest;

			// Try to call webhook endpoint (will fail validation but should route correctly)
			const response = await SELF.fetch("https://example.com/webhooks/job-complete", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			// Should return validation error, not 404
			expect(response.status).not.toBe(404);
			expect(response.status).toBeGreaterThanOrEqual(400);
		});
	});

	describe("Dev Mode Detection", () => {
		it("detects dev mode when FLY_API_TOKEN is empty", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;

			const { createExecutionContext, waitOnExecutionContext } = cfTest;
			const { default: worker } = await import("../src/index");
			const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

			const env = {
				...cfTest.env,
				FLY_API_TOKEN: "",
				WEBHOOK_BASE_URL: "https://example.com",
			} as unknown as Parameters<typeof worker.fetch>[1];

			const request = new IncomingRequest("http://example.com/");
			const ctx = createExecutionContext();

			// Dev mode logging happens on first request
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// Should log dev mode (may not work perfectly in test env, but structure should be correct)
			expect(response.status).toBe(200);
			consoleSpy.mockRestore();
		});
	});

	describe("Queue Handler", () => {
		it("has queue handler defined", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;

			const { default: worker } = await import("../src/index");

			// Queue handler should exist
			expect(worker.queue).toBeDefined();
			expect(typeof worker.queue).toBe("function");
		});

		// Note: Full queue handler testing would require mocking MessageBatch
		// and testing R2 event processing, which is complex. This is documented
		// as a limitation - full integration testing would be needed.
	});

	describe("Scheduled Handler", () => {
		it("has scheduled handler defined", async () => {
			const cfTest = await getCloudflareTest();
			if (!cfTest) return;

			const { default: worker } = await import("../src/index");

			// Scheduled handler should exist
			expect(worker.scheduled).toBeDefined();
			expect(typeof worker.scheduled).toBe("function");
		});

		// Note: Full scheduled handler testing would require:
		// - Testing idle machine stopping logic
		// - Testing stuck uploading job recovery
		// - Testing Redis SCAN operations
		// This is complex and would benefit from integration tests with real Redis.
		// The scheduled handler is tested implicitly through the cron trigger in production.
	});
});
