import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Type assertion for test environment - ProvidedEnv may not have all Env properties
type TestEnv = typeof env & Record<string, unknown>;

describe("Worker Health Check", () => {
	it("responds with ok status on root path", async () => {
		const request = new IncomingRequest("http://example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env as TestEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const data = (await response.json()) as { status: string; service: string };
		expect(data).toEqual({
			status: "ok",
			service: "tcoder",
		});
	});

	it("responds with ok status (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		const data = (await response.json()) as { status: string; service: string };
		expect(data.status).toBe("ok");
		expect(data.service).toBe("tcoder");
	});
});
