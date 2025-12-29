import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../../packages/logger";
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
			const startTime = Date.now();
			const requestId = crypto.randomUUID();
			const loggerLayer = makeLoggerLayer({ component: "Stats", logLevel: "info" });
			const effectLoggerLayer = makeEffectLoggerLayer("info");

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("GET /stats - Request received", {
						requestId,
						method: "GET",
						path: "/stats",
						userAgent: c.req.header("user-agent"),
						ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			try {
				const redisLayer = makeRedisLayer(c.env);
				const redis = Redis.fromEnv(c.env);

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Fetching admission stats", {
							requestId,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const stats = await Effect.runPromise(
					Effect.gen(function* () {
						const admission = yield* getAdmissionStats();
						return admission;
					})
						.pipe(Effect.provide(redisLayer))
						.pipe(Effect.provide(loggerLayer))
						.pipe(Effect.provide(effectLoggerLayer)),
				);

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Fetching job counts from Redis", {
							requestId,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const pendingCount = await redis.zcard(RedisKeys.jobsPending);
				const activeJobs = await redis.hgetall<Record<string, string>>(RedisKeys.jobsActive);

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job counts retrieved", {
							requestId,
							pendingCount,
							activeCount: activeJobs ? Object.keys(activeJobs).length : 0,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				// Get machines from Fly.io (skip in dev mode)
				let flyMachines: Machine[] = [];
				let flyMachinesError: string | null = null;

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Fetching machines from Fly.io", {
							requestId,
							appName: c.env.FLY_APP_NAME,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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

					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.info("Found machines from Fly.io", {
								requestId,
								count: flyMachines.length,
								machineIds: flyMachines.map((m) => m.id),
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
				} catch (error) {
					flyMachinesError = error instanceof Error ? error.message : String(error);
					await Effect.runPromise(
						Effect.gen(function* () {
							const logger = yield* LoggerService;
							yield* logger.error("Failed to fetch machines from Fly.io", error, {
								requestId,
								appName: c.env.FLY_APP_NAME,
								event: "fly.machines.fetch_failed",
							});
						}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
					);
				}

				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("GET /stats - Request completed", {
							requestId,
							statusCode: 200,
							durationMs: duration,
							pendingJobs: pendingCount,
							activeJobs: activeJobs ? Object.keys(activeJobs).length : 0,
							flyMachinesCount: flyMachines.length,
							event: "request.completed",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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
				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.error("GET /stats - Redis error", error, {
							requestId,
							statusCode: 500,
							durationMs: duration,
							event: "request.failed",
							errorType: "redis_error",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				return c.json({ error: "Redis connection failed" }, 500);
			}
		})
		.get("/status", async (c) => {
			const startTime = Date.now();
			const requestId = crypto.randomUUID();
			const loggerLayer = makeLoggerLayer({ component: "Stats", logLevel: "info" });
			const effectLoggerLayer = makeEffectLoggerLayer("info");

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("GET /status - Request received", {
						requestId,
						method: "GET",
						path: "/status",
						userAgent: c.req.header("user-agent"),
						ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			const redis = Redis.fromEnv(c.env);
			const serverTime = Date.now();
			const serverTimeISO = new Date().toISOString();

			try {
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.debug("Testing Redis connection", {
							requestId,
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const redisPing = await redis.ping();
				const testKey = `status:check:${serverTime}`;
				await redis.set(testKey, serverTimeISO, { ex: 60 });
				const retrievedValue = await redis.get<string>(testKey);
				await redis.del(testKey);

				const redisHealthy = redisPing === "PONG" && retrievedValue === serverTimeISO;

				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Redis health check completed", {
							requestId,
							connected: true,
							ping: redisPing,
							testRead: retrievedValue === serverTimeISO,
							healthy: redisHealthy,
							event: "health.check.redis",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("GET /status - Request completed", {
							requestId,
							statusCode: 200,
							durationMs: duration,
							status: "ok",
							event: "request.completed",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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
				const duration = Date.now() - startTime;
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.error("GET /status - Redis health check failed", error, {
							requestId,
							statusCode: 500,
							durationMs: duration,
							event: "health.check.failed",
							errorType: "redis_error",
						});
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);

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
