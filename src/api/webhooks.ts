import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../../packages/logger";
import { RedisKeys } from "../redis/schema";
import { webhookPayloadSchema } from "./schemas";
import type { Env } from "./types";

export const createWebhookRoutes = () => {
	/**
	 * POST /webhooks/job-complete - Receive job completion notifications
	 */
	const app = new Hono<{ Bindings: Env }>().post("/webhooks/job-complete", zValidator("json", webhookPayloadSchema), async (c) => {
		const startTime = Date.now();
		const requestId = crypto.randomUUID();
		const loggerLayer = makeLoggerLayer({ component: "Webhooks", logLevel: "info" });
		const effectLoggerLayer = makeEffectLoggerLayer("info");

		const payload = c.req.valid("json");

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("POST /webhooks/job-complete - Request received", {
					requestId,
					method: "POST",
					path: "/webhooks/job-complete",
					jobId: payload.jobId,
					status: payload.status,
					outputCount: payload.outputs.length,
					hasError: !!payload.error,
					duration: payload.duration,
					userAgent: c.req.header("user-agent"),
					ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
					event: "webhook.received",
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		try {
			const redis = Redis.fromEnv(c.env);

			const now = Date.now();
			const updates: Record<string, string> = {
				status: payload.status,
				completedAt: String(now),
			};

			if (payload.outputs.length > 0) {
				updates.outputs = JSON.stringify(
					payload.outputs.map((o) => ({
						quality: o.quality,
						url: o.url,
					})),
				);
			}

			if (payload.error) {
				updates.error = payload.error;
			}

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Updating job status in Redis", {
						requestId,
						jobId: payload.jobId,
						status: payload.status,
						outputCount: payload.outputs.length,
						hasError: !!payload.error,
						event: "job.status.update",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			await redis.hset(RedisKeys.jobStatus(payload.jobId), updates);
			await redis.hdel(RedisKeys.jobsActive, payload.jobId);

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					if (payload.status === "completed") {
						yield* logger.info("Job completed successfully", {
							requestId,
							jobId: payload.jobId,
							outputCount: payload.outputs.length,
							duration: payload.duration,
							outputs: payload.outputs.map((o) => ({ quality: o.quality, url: o.url })),
							event: "job.completed",
						});
					} else {
						yield* logger.error("Job failed", payload.error ? new Error(payload.error) : undefined, {
							requestId,
							jobId: payload.jobId,
							error: payload.error,
							duration: payload.duration,
							event: "job.failed",
						});
					}
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			const duration = Date.now() - startTime;
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("POST /webhooks/job-complete - Request completed", {
						requestId,
						jobId: payload.jobId,
						statusCode: 200,
						durationMs: duration,
						event: "request.completed",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			return c.json({ received: true });
		} catch (error) {
			const duration = Date.now() - startTime;
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.error("POST /webhooks/job-complete - Redis error", error, {
						requestId,
						jobId: payload.jobId,
						statusCode: 500,
						durationMs: duration,
						event: "request.failed",
						errorType: "redis_error",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			return c.json({ error: "Redis connection failed" }, 500);
		}
	});

	return app;
};
