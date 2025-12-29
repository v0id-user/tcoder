import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { flyClient } from "../../fly/fly-client";
import type { Machine } from "../../fly/fly-machine-apis";
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

				// Get machines from Fly.io (skip in dev mode)
				let flyMachines: Machine[] = [];
				let flyMachinesError: string | null = null;

				try {
					const response = await flyClient.Machines_list(
						{
							app_name: c.env.FLY_APP_NAME,
						},
						undefined,
						{
							headers: {
								Authorization: `Bearer ${c.env.FLY_API_TOKEN}`,
							},
						},
					);

					// Extract machines from response (same pattern as machine-pool.ts)
					flyMachines = (response.data as { machines?: Machine[] })?.machines || [];

					console.log(`[Stats] Found ${flyMachines.length} machines from Fly.io`);
				} catch (error) {
					flyMachinesError = error instanceof Error ? error.message : String(error);
					console.error("[Stats] Failed to fetch machines from Fly.io:", error);
				}

				return c.json({
					machines: stats,
					pendingJobs: pendingCount,
					activeJobs: activeJobs ? Object.keys(activeJobs).length : 0,
					activeJobIds: activeJobs ? Object.keys(activeJobs) : [],
					flyMachines: {
						count: flyMachines.length,
						machines: flyMachines.map((m) => ({
							id: m.id,
							name: m.name,
							state: m.state,
							region: m.region,
							created_at: m.created_at,
							updated_at: m.updated_at,
						})),
						error: flyMachinesError,
					},
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
