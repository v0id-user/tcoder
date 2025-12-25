/**
 * Redis Client for Fly Workers (Bun runtime)
 *
 * Uses ioredis for direct TCP connection to Redis.
 * Workers get Redis URL via REDIS_URL environment variable.
 */

import Redis from "ioredis";
import { Context, Effect, Layer } from "effect";

// =============================================================================
// Error Types
// =============================================================================

export type RedisError =
	| { readonly _tag: "ConnectionError"; readonly reason: string }
	| { readonly _tag: "CommandError"; readonly reason: string };

// =============================================================================
// Redis Service
// =============================================================================

export class RedisService extends Context.Tag("RedisService")<RedisService, { readonly client: Redis }>() {}

// =============================================================================
// Helper to wrap Redis operations
// =============================================================================

export const redisEffect = <T>(operation: (redis: Redis) => Promise<T>): Effect.Effect<T, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		return yield* Effect.tryPromise({
			try: () => operation(client),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});
	});

// =============================================================================
// Layer from environment variables
// =============================================================================

export const makeRedisLayer = Layer.effect(
	RedisService,
	Effect.sync(() => {
		const url = process.env.REDIS_URL;

		if (!url) {
			console.error("Missing env: REDIS_URL");
			process.exit(1);
		}

		console.log(`[Redis] Connecting to ${url.replace(/\/\/.*@/, "//***@").substring(0, 50)}...`);

		const client = new Redis(url, {
			maxRetriesPerRequest: 3,
			retryStrategy: (times) => {
				if (times > 3) return null;
				return Math.min(times * 200, 1000);
			},
		});

		client.on("error", (err) => {
			console.error("[Redis] Connection error:", err.message);
		});

		client.on("connect", () => {
			console.log("[Redis] Connected");
		});

		return { client };
	}),
);
