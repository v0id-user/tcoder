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

describe("Worker Health Check", () => {
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
	});

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
});
