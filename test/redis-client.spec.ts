/**
 * Tests for Redis Client
 *
 * Tests Redis service layer, layer creation, and error handling.
 */

import { Redis } from "@upstash/redis/cloudflare";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { type RedisError, RedisService, makeRedisLayer, redisEffect } from "../src/redis/client";
import { MockRedis, createMockRedisLayer, extractErrorFromExit, runWithMockRedis, runWithMockRedisExit } from "./test-helpers";

describe("Redis Client", () => {
	describe("makeRedisLayer", () => {
		it("creates a valid Redis layer", () => {
			const env = {
				UPSTASH_REDIS_REST_URL: "https://example.com",
				UPSTASH_REDIS_REST_TOKEN: "test-token",
			};

			const layer = makeRedisLayer(env);

			expect(layer).toBeDefined();
			// Layer is a complex Effect structure, so we mainly verify it's created
			expect(Layer.isLayer(layer)).toBe(true);
		});
	});

	describe("RedisService", () => {
		it("provides Redis client through layer", async () => {
			const mockRedis = new MockRedis();
			const layer = createMockRedisLayer(mockRedis);

			const program = Effect.gen(function* () {
				const { client } = yield* RedisService;
				expect(client).toBeDefined();
				return yield* Effect.succeed("ok");
			});

			const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
			expect(result).toBe("ok");
		});
	});

	describe("redisEffect", () => {
		it("wraps successful Redis operations", async () => {
			const mockRedis = new MockRedis();
			await mockRedis.set("test-key", "test-value");

			const program = redisEffect((client) => client.get<string>("test-key"));

			const result = await runWithMockRedis(program, mockRedis);
			expect(result).toBe("test-value");
		});

		it("transforms errors to RedisError", async () => {
			const mockRedis = new MockRedis();
			// Override get to throw an error
			const originalGet = mockRedis.get.bind(mockRedis);
			mockRedis.get = async () => {
				throw new Error("Connection failed");
			};

			const program = redisEffect((client) => client.get<string>("test-key"));

			const exit = await runWithMockRedisExit(program, mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("CommandError");
				if ("reason" in error) {
					expect(error.reason).toContain("Connection failed");
				}
			}
		});

		it("handles various Redis operations", async () => {
			const mockRedis = new MockRedis();

			// Test hset/hget
			const hsetProgram = redisEffect((client) => client.hset("test-hash", { field1: "value1", field2: "value2" }));
			await runWithMockRedis(hsetProgram, mockRedis);

			const hgetProgram = redisEffect((client) => client.hget<string>("test-hash", "field1"));
			const value = await runWithMockRedis(hgetProgram, mockRedis);
			expect(value).toBe("value1");

			// Test zadd/zcard
			const zaddProgram = redisEffect((client) => client.zadd("test-zset", { score: 1, member: "member1" }));
			await runWithMockRedis(zaddProgram, mockRedis);

			const zcardProgram = redisEffect((client) => client.zcard("test-zset"));
			const count = await runWithMockRedis(zcardProgram, mockRedis);
			expect(count).toBe(1);
		});
	});
});
