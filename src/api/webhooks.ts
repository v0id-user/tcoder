import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Hono } from "hono";
import { RedisKeys } from "../redis/schema";
import { webhookPayloadSchema } from "./schemas";
import type { Env } from "./types";

export const createWebhookRoutes = () => {
	/**
	 * POST /webhooks/job-complete - Receive job completion notifications
	 */
	const app = new Hono<{ Bindings: Env }>().post("/webhooks/job-complete", zValidator("json", webhookPayloadSchema), async (c) => {
		const payload = c.req.valid("json");
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

			await redis.hset(RedisKeys.jobStatus(payload.jobId), updates);
			await redis.hdel(RedisKeys.jobsActive, payload.jobId);

			console.log(`[Webhook] Job ${payload.jobId} ${payload.status}`, {
				outputs: payload.outputs.length,
				duration: payload.duration,
				error: payload.error,
			});

			return c.json({ received: true });
		} catch (error) {
			console.error("[Route] Redis error in /webhooks/job-complete:", error);
			return c.json({ error: "Redis connection failed" }, 500);
		}
	});

	return app;
};

