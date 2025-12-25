/**
 * Redis Client for Fly Workers (Bun runtime)
 *
 * Uses standard @upstash/redis (not cloudflare variant).
 * Workers get Redis credentials via environment variables.
 */

import { Effect, Layer, Context } from "effect";
import { Redis } from "@upstash/redis";

// =============================================================================
// Error Types
// =============================================================================

export type RedisError =
	| { readonly _tag: "ConnectionError"; readonly reason: string }
	| { readonly _tag: "CommandError"; readonly reason: string };

// =============================================================================
// Redis Service
// =============================================================================

export class RedisService extends Context.Tag("RedisService")<
	RedisService,
	{ readonly client: Redis }
>() {}

// =============================================================================
// Helper to wrap Redis operations
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
// Layer from environment variables
// =============================================================================

export const makeRedisLayer = Layer.effect(
	RedisService,
	Effect.sync(() => {
		const url = process.env.UPSTASH_REDIS_REST_URL;
		const token = process.env.UPSTASH_REDIS_REST_TOKEN;

		if (!url || !token) {
			throw new Error(
				"Missing: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN"
			);
		}

		return { client: new Redis({ url, token }) };
	})
);

