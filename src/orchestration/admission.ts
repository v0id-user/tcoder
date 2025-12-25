/**
 * Admission Controller for RWOS
 *
 * Enforces rate limiting (1 req/sec for Fly API) and capacity limits.
 * Prevents overloading Fly Machines API and controls costs.
 */

import { Effect } from "effect";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys, deserializeMachinePoolEntry } from "../redis/schema";

// =============================================================================
// Admission Error Types
// =============================================================================

export type AdmissionError =
	| RedisError
	| { readonly _tag: "RateLimited"; readonly retryAfterMs: number }
	| { readonly _tag: "CapacityFull"; readonly currentMachines: number };

// =============================================================================
// Admission Control Operations
// =============================================================================

/**
 * Check rate limit for Fly API calls (1 req/sec).
 * Returns true if allowed, false if rate limited.
 */
export const checkRateLimit = (): Effect.Effect<boolean, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// INCR with 1 second expiry
		const count = yield* Effect.tryPromise({
			try: async () => {
				const pipe = client.pipeline();
				pipe.incr(RedisKeys.countersRateLimit);
				pipe.expire(RedisKeys.countersRateLimit, 1);
				const results = await pipe.exec<[number, number]>();
				return results[0];
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return count <= 1;
	});

/**
 * Wait for rate limit slot (blocking with retry).
 */
export const waitForRateLimit = (): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		let allowed = yield* checkRateLimit();

		while (!allowed) {
			yield* Effect.sleep("1 second");
			allowed = yield* checkRateLimit();
		}
	});

/**
 * Check if we have capacity to create a new machine.
 * Counts all machines in pool (running + stopped) vs MAX_MACHINES.
 */
export const checkCapacity = (): Effect.Effect<{ allowed: boolean; currentMachines: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		// Count machines in pool (running + stopped)
		const poolEntries = yield* redisEffect((client) => client.hgetall<Record<string, string>>(RedisKeys.machinesPool));

		const currentMachines = poolEntries ? Object.keys(poolEntries).length : 0;
		const allowed = currentMachines < RWOS_CONFIG.MAX_MACHINES;

		return { allowed, currentMachines };
	});

/**
 * Reserve a machine slot (increment counter).
 */
export const reserveMachineSlot = (): Effect.Effect<number, RedisError, RedisService> =>
	redisEffect((client) => client.incr(RedisKeys.countersActiveMachines));

/**
 * Release a machine slot (decrement counter).
 */
export const releaseMachineSlot = (): Effect.Effect<number, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// Decrement but ensure it doesn't go below 0
		const count = yield* Effect.tryPromise({
			try: async () => {
				const current = await client.get<number>(RedisKeys.countersActiveMachines);
				if (!current || current <= 0) {
					await client.set(RedisKeys.countersActiveMachines, "0");
					return 0;
				}
				return await client.decr(RedisKeys.countersActiveMachines);
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return count;
	});

/**
 * Full admission check: capacity only (Fly handles rate limiting with 429s).
 * Returns true if a machine can be created.
 */
export const canCreateMachine = (): Effect.Effect<{ allowed: boolean; reason?: string }, RedisError, RedisService> =>
	Effect.gen(function* () {
		// Check capacity (pool-based: running + stopped)
		const { allowed, currentMachines } = yield* checkCapacity();
		if (!allowed) {
			return {
				allowed: false,
				reason: `Capacity full (${currentMachines}/${RWOS_CONFIG.MAX_MACHINES})`,
			};
		}

		return { allowed: true };
	});

/**
 * Attempt to acquire a machine slot with admission control.
 * Checks capacity (pool-based), no rate limit waiting (Fly handles 429s).
 */
export const acquireMachineSlot = (): Effect.Effect<
	{ acquired: boolean; slotNumber?: number; reason?: string },
	RedisError,
	RedisService
> =>
	Effect.gen(function* () {
		// Check capacity (pool-based: running + stopped)
		const { allowed, currentMachines } = yield* checkCapacity();
		if (!allowed) {
			return {
				acquired: false,
				reason: `Capacity full (${currentMachines}/${RWOS_CONFIG.MAX_MACHINES})`,
			};
		}

		// Reserve slot (increment counter for tracking)
		const slotNumber = yield* reserveMachineSlot();

		// Double-check we didn't exceed limit (race condition protection)
		// Note: This uses the counter, but actual capacity is pool-based
		const { allowed: stillAllowed } = yield* checkCapacity();
		if (!stillAllowed) {
			yield* releaseMachineSlot();
			return {
				acquired: false,
				reason: "Capacity exceeded after reservation",
			};
		}

		return { acquired: true, slotNumber };
	});

/**
 * Get current admission stats for monitoring.
 * Returns pool size (running + stopped) and max machines.
 */
export const getAdmissionStats = (): Effect.Effect<{ activeMachines: number; maxMachines: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		const poolEntries = yield* redisEffect((client) => client.hgetall<Record<string, string>>(RedisKeys.machinesPool));
		const poolSize = poolEntries ? Object.keys(poolEntries).length : 0;

		return {
			activeMachines: poolSize,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
		};
	});
