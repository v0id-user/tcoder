/**
 * Test Helpers for RWOS Tests
 *
 * Provides utilities for Effect-based testing, mock data factories,
 * and test setup helpers.
 */

import type { Redis } from "@upstash/redis/cloudflare";
import { Effect, Layer } from "effect";
import { type RedisError, RedisService } from "../src/redis/client";
import type { JobData, MachinePoolEntry } from "../src/redis/schema";

// =============================================================================
// Mock Redis Client (In-Memory)
// =============================================================================

/**
 * Simple in-memory Redis mock for unit tests.
 * Only implements the methods we actually use in the codebase.
 */
export class MockRedis {
	private data: Map<string, string> = new Map();
	private hashes: Map<string, Map<string, string>> = new Map();
	private sets: Map<string, Set<string>> = new Map();
	private sortedSets: Map<string, Map<string, number>> = new Map();
	private expirations: Map<string, number> = new Map();

	async get<T>(key: string): Promise<T | null> {
		const expiration = this.expirations.get(key);
		if (expiration && Date.now() > expiration) {
			this.expirations.delete(key);
			this.data.delete(key);
			return null;
		}
		const value = this.data.get(key);
		return (value as T) || null;
	}

	async set(key: string, value: string, options?: { ex?: number }): Promise<string> {
		this.data.set(key, value);
		if (options?.ex) {
			this.expirations.set(key, Date.now() + options.ex * 1000);
		}
		return "OK";
	}

	async del(...keys: string[]): Promise<number> {
		let count = 0;
		for (const key of keys) {
			if (this.data.delete(key) || this.hashes.delete(key) || this.sets.delete(key) || this.sortedSets.delete(key)) {
				count++;
			}
			this.expirations.delete(key);
		}
		return count;
	}

	async hget<T>(key: string, field: string): Promise<T | null> {
		const hash = this.hashes.get(key);
		if (!hash) return null;
		const value = hash.get(field);
		return (value as T) || null;
	}

	async hset(key: string, data: Record<string, string> | string, value?: string): Promise<number> {
		if (!this.hashes.has(key)) {
			this.hashes.set(key, new Map());
		}
		const hash = this.hashes.get(key);
		if (!hash) return 0;

		if (typeof data === "string" && value !== undefined) {
			hash.set(data, value);
			return 1;
		}

		if (typeof data === "object") {
			let count = 0;
			for (const [field, val] of Object.entries(data)) {
				hash.set(field, val);
				count++;
			}
			return count;
		}

		return 0;
	}

	async hgetall<T extends Record<string, string>>(key: string): Promise<T | null> {
		const hash = this.hashes.get(key);
		if (!hash || hash.size === 0) return null;
		return Object.fromEntries(hash) as T;
	}

	async hdel(key: string, ...fields: string[]): Promise<number> {
		const hash = this.hashes.get(key);
		if (!hash) return 0;
		let count = 0;
		for (const field of fields) {
			if (hash.delete(field)) count++;
		}
		return count;
	}

	async incr(key: string): Promise<number> {
		const current = Number(this.data.get(key) || "0");
		const next = current + 1;
		this.data.set(key, String(next));
		return next;
	}

	async decr(key: string): Promise<number> {
		const current = Number(this.data.get(key) || "0");
		const next = Math.max(0, current - 1);
		this.data.set(key, String(next));
		return next;
	}

	async expire(key: string, seconds: number): Promise<number> {
		if (this.data.has(key) || this.hashes.has(key) || this.sets.has(key) || this.sortedSets.has(key)) {
			this.expirations.set(key, Date.now() + seconds * 1000);
			return 1;
		}
		return 0;
	}

	async sadd(key: string, ...members: string[]): Promise<number> {
		if (!this.sets.has(key)) {
			this.sets.set(key, new Set());
		}
		const set = this.sets.get(key);
		if (!set) return 0;
		let count = 0;
		for (const member of members) {
			if (!set.has(member)) {
				set.add(member);
				count++;
			}
		}
		return count;
	}

	async srem(key: string, ...members: string[]): Promise<number> {
		const set = this.sets.get(key);
		if (!set) return 0;
		let count = 0;
		for (const member of members) {
			if (set.delete(member)) count++;
		}
		return count;
	}

	async smembers(key: string): Promise<string[]> {
		const set = this.sets.get(key);
		if (!set) return [];
		return Array.from(set);
	}

	async spop(key: string, count?: number): Promise<string | string[] | null> {
		const set = this.sets.get(key);
		if (!set || set.size === 0) return null;

		const n = count || 1;
		const items: string[] = [];
		for (let i = 0; i < n && set.size > 0; i++) {
			const value = Array.from(set)[0];
			set.delete(value);
			items.push(value);
		}

		return count === 1 ? items[0] || null : items.length > 0 ? items : null;
	}

	async zadd(key: string, data: { score: number; member: string } | { score: number; member: string }[]): Promise<number> {
		if (!this.sortedSets.has(key)) {
			this.sortedSets.set(key, new Map());
		}
		const zset = this.sortedSets.get(key);
		if (!zset) return 0;

		const items = Array.isArray(data) ? data : [data];
		let count = 0;
		for (const item of items) {
			const exists = zset.has(item.member);
			zset.set(item.member, item.score);
			if (!exists) count++;
		}
		return count;
	}

	async zcard(key: string): Promise<number> {
		const zset = this.sortedSets.get(key);
		return zset ? zset.size : 0;
	}

	async zpopmin(key: string, count = 1): Promise<string[]> {
		const zset = this.sortedSets.get(key);
		if (!zset || zset.size === 0) return [];

		const sorted = Array.from(zset.entries()).sort((a, b) => a[1] - b[1]);
		const results: string[] = [];
		for (let i = 0; i < Math.min(count, sorted.length); i++) {
			const [member, score] = sorted[i];
			zset.delete(member);
			results.push(JSON.stringify({ member, score }));
		}
		return results;
	}

	async scan(cursor: string | number, options?: { match?: string; count?: number }): Promise<[string | number, string[]]> {
		// Simple scan implementation (doesn't support patterns properly, but good enough for tests)
		const allKeys = new Set<string>();
		for (const key of this.data.keys()) allKeys.add(key);
		for (const key of this.hashes.keys()) allKeys.add(key);
		for (const key of this.sets.keys()) allKeys.add(key);
		for (const key of this.sortedSets.keys()) allKeys.add(key);

		const keys = Array.from(allKeys);
		return [0, keys]; // Return all keys, cursor 0 means done
	}

	async ping(): Promise<string> {
		return "PONG";
	}

	pipeline(): MockPipeline {
		return new MockPipeline(this);
	}

	// Helper to reset all data
	reset(): void {
		this.data.clear();
		this.hashes.clear();
		this.sets.clear();
		this.sortedSets.clear();
		this.expirations.clear();
	}
}

class MockPipeline {
	private commands: Array<{ cmd: () => Promise<unknown>; key?: string }> = [];

	constructor(private redis: MockRedis) {}

	async get<T>(key: string): Promise<T | null> {
		return this.redis.get<T>(key);
	}

	set(key: string, value: string, options?: { ex?: number }): this {
		this.commands.push({ cmd: () => this.redis.set(key, value, options), key });
		return this;
	}

	del(...keys: string[]): this {
		this.commands.push({ cmd: () => this.redis.del(...keys) });
		return this;
	}

	hgetall<T extends Record<string, string>>(key: string): this {
		this.commands.push({ cmd: () => this.redis.hgetall<T>(key), key });
		return this;
	}

	hset(key: string, data: Record<string, string>): this {
		this.commands.push({ cmd: () => this.redis.hset(key, data), key });
		return this;
	}

	hdel(key: string, ...fields: string[]): this {
		this.commands.push({ cmd: () => this.redis.hdel(key, ...fields), key });
		return this;
	}

	incr(key: string): this {
		this.commands.push({ cmd: () => this.redis.incr(key), key });
		return this;
	}

	decr(key: string): this {
		this.commands.push({ cmd: () => this.redis.decr(key), key });
		return this;
	}

	expire(key: string, seconds: number): this {
		this.commands.push({ cmd: () => this.redis.expire(key, seconds), key });
		return this;
	}

	zadd(key: string, data: { score: number; member: string } | { score: number; member: string }[]): this {
		this.commands.push({ cmd: () => this.redis.zadd(key, data), key });
		return this;
	}

	sadd(key: string, ...members: string[]): this {
		this.commands.push({ cmd: () => this.redis.sadd(key, ...members), key });
		return this;
	}

	srem(key: string, ...members: string[]): this {
		this.commands.push({ cmd: () => this.redis.srem(key, ...members), key });
		return this;
	}

	async exec<T extends unknown[] = unknown[]>(): Promise<T> {
		const results = await Promise.all(this.commands.map(({ cmd }) => cmd()));
		this.commands = [];
		return results as T;
	}
}

// =============================================================================
// Test Data Factories
// =============================================================================

export function createTestJobData(overrides?: Partial<JobData>): JobData {
	const now = Date.now();
	return {
		jobId: `test-job-${now}`,
		status: "pending",
		inputKey: `inputs/test-job-${now}/video.mp4`,
		outputUrl: `outputs/test-job-${now}`,
		preset: "default",
		webhookUrl: "https://example.com/webhooks/job-complete",
		timestamps: {
			createdAt: now,
			queuedAt: now,
		},
		retries: 0,
		...overrides,
	};
}

export function createTestMachinePoolEntry(overrides?: Partial<MachinePoolEntry>): MachinePoolEntry {
	const now = Date.now();
	return {
		machineId: `machine-${now}`,
		state: "running",
		lastActiveAt: now,
		createdAt: now,
		...overrides,
	};
}

/**
 * Helper to create a mock Machine for Fly API
 */
export function createMockMachine(overrides?: Partial<{ id: string; name: string; state: string; region: string }>): {
	id: string;
	name: string;
	state: string;
	region: string;
	created_at: string;
} {
	const now = Date.now();
	return {
		id: `mock-machine-${now}`,
		name: `machine-${now}`,
		state: "started",
		region: "iad",
		created_at: new Date().toISOString(),
		...overrides,
	};
}

// =============================================================================
// Effect Test Helpers
// =============================================================================

/**
 * Create a Redis layer with a mock Redis client for testing
 */
export function createMockRedisLayer(mockRedis: MockRedis = new MockRedis()): Layer.Layer<RedisService> {
	return Layer.succeed(RedisService, {
		client: mockRedis as unknown as Redis,
	});
}

/**
 * Run an Effect program with a mock Redis layer
 */
export async function runWithMockRedis<T, E>(program: Effect.Effect<T, E, RedisService>, mockRedis?: MockRedis): Promise<T> {
	const layer = createMockRedisLayer(mockRedis);
	return Effect.runPromise(program.pipe(Effect.provide(layer)));
}

/**
 * Run an Effect program and get the Exit result (for error testing)
 */
export async function runWithMockRedisExit<T, E>(
	program: Effect.Effect<T, E, RedisService>,
	mockRedis?: MockRedis,
): Promise<import("effect/Exit").Exit<T, E>> {
	const layer = createMockRedisLayer(mockRedis);
	return Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
}

/**
 * Assert that an Effect fails with a specific error type
 */
export function expectEffectError<T extends { _tag: string }>(error: unknown, expectedTag: T["_tag"]): asserts error is T {
	if (typeof error !== "object" || error === null) {
		throw new Error(`Expected error object, got ${typeof error}`);
	}
	if (!("_tag" in error) || error._tag !== expectedTag) {
		throw new Error(`Expected error with _tag="${expectedTag}", got ${(error as { _tag?: string })._tag}`);
	}
}

/**
 * Extract error from Exit result for assertions
 */
export function extractErrorFromExit<E>(exit: import("effect/Exit").Exit<unknown, E>): E | null {
	if (exit._tag === "Failure") {
		return exit.cause._tag === "Fail" ? exit.cause.error : null;
	}
	return null;
}

// =============================================================================
// Cloudflare Test Helpers
// =============================================================================

let cloudflareTestCache: typeof import("cloudflare:test") | null = null;

/**
 * Get cloudflare:test utilities (for integration tests)
 */
export async function getCloudflareTest() {
	if (cloudflareTestCache !== null) return cloudflareTestCache;
	try {
		cloudflareTestCache = await import("cloudflare:test");
		return cloudflareTestCache;
	} catch {
		cloudflareTestCache = null;
		return null;
	}
}
