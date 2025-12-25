/**
 * Upstash Redis Client for RWOS
 *
 * Uses @upstash/redis/cloudflare for Cloudflare Workers REST API.
 * https://upstash.com/docs/redis/tutorials/cloudflare_workers_with_redis
 */

import { Effect, Context, Layer } from "effect";
import { Redis } from "@upstash/redis/cloudflare";

// =============================================================================
// Environment Type (Cloudflare Workers pattern)
// =============================================================================

export type RedisEnv = {
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
};

// =============================================================================
// Error Types
// =============================================================================

export type RedisError =
	| { readonly _tag: "ConnectionError"; readonly reason: string }
	| { readonly _tag: "CommandError"; readonly reason: string };

// =============================================================================
// Redis Service - Exposes the Upstash client
// =============================================================================

export class RedisService extends Context.Tag("RedisService")<
	RedisService,
	{ readonly client: Redis }
>() {}

// =============================================================================
// Helper to wrap Redis operations in Effect
// =============================================================================

export const redisEffect = <T>(
	operation: (redis: Redis) => Promise<T>
): Effect.Effect<T, RedisError, RedisService> =>
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
// Layer Constructor - Cloudflare Workers pattern
// =============================================================================

/**
 * Create Redis layer from Cloudflare Worker env bindings.
 * Usage: makeRedisLayer(c.env) where c is Hono context
 */
export const makeRedisLayer = (env: RedisEnv) =>
	Layer.succeed(RedisService, {
		client: Redis.fromEnv(env),
	});
