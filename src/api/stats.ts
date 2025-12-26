import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { getAdmissionStats } from "../orchestration/admission";
import { makeRedisLayer } from "../redis/client";
import { RedisKeys } from "../redis/schema";
import type { Env } from "./types";

const buildStatsRoutes = () => {
	/**
	 * GET /stats - Get system stats
	 */
	const app = new Hono<{ Bindings: Env }>()
		.get("/stats", async (c) => {
			try {
				const redisLayer = makeRedisLayer(c.env);
				const redis = Redis.fromEnv(c.env);

				const stats = await Effect.runPromise(
					Effect.gen(function* () {
						const admission = yield* getAdmissionStats();
						return admission;
					}).pipe(Effect.provide(redisLayer)),
				);

				const pendingCount = await redis.zcard(RedisKeys.jobsPending);
				const activeJobs = await redis.hgetall<Record<string, string>>(RedisKeys.jobsActive);

				return c.json({
					machines: stats,
					pendingJobs: pendingCount,
					activeJobs: activeJobs ? Object.keys(activeJobs).length : 0,
					activeJobIds: activeJobs ? Object.keys(activeJobs) : [],
				});
			} catch (error) {
				console.error("[Route] Redis error in /stats:", error);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.get("/status", async (c) => {
			const redis = Redis.fromEnv(c.env);
			const serverTime = Date.now();
			const serverTimeISO = new Date().toISOString();

			try {
				const redisPing = await redis.ping();
				const testKey = `status:check:${serverTime}`;
				await redis.set(testKey, serverTimeISO, { ex: 60 });
				const retrievedValue = await redis.get<string>(testKey);
				await redis.del(testKey);

				return c.json({
					status: "ok",
					serverTime: {
						timestamp: serverTime,
						iso: serverTimeISO,
						utc: new Date().toUTCString(),
					},
					redis: {
						connected: true,
						ping: redisPing,
						testRead: retrievedValue === serverTimeISO,
					},
				});
			} catch (error) {
				return c.json(
					{
						status: "error",
						serverTime: {
							timestamp: serverTime,
							iso: serverTimeISO,
							utc: new Date().toUTCString(),
						},
						redis: {
							connected: false,
							error: error instanceof Error ? error.message : String(error),
						},
					},
					500,
				);
			}
		});

	return app;
};

export const createStatsRoutes = (): ReturnType<typeof buildStatsRoutes> => {
	return buildStatsRoutes();
};
