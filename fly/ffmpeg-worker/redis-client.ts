/**
 * Redis Client for Fly Workers (Bun runtime)
 *
 * Uses @upstash/redis HTTP client for compatibility with:
 * - Production: Upstash Redis
 * - Local dev: Serverless Redis HTTP (SRH) proxy
 *
 * https://upstash.com/docs/redis/sdks/ts/developing
 */

import { Redis } from "@upstash/redis";
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
		const url = process.env.UPSTASH_REDIS_REST_URL;
		const token = process.env.UPSTASH_REDIS_REST_TOKEN;

		if (!url || !token) {
			console.error("Missing env: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
			process.exit(1);
		}

		console.log(`[Redis] Connecting to ${url.substring(0, 50)}...`);

		const client = new Redis({ url, token });

		return { client };
	}),
);
