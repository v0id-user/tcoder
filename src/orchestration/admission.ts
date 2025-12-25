/**
 * Admission Controller for RWOS
 *
 * Enforces rate limiting (1 req/sec for Fly API) and capacity limits.
 * Prevents overloading Fly Machines API and controls costs.
 */

import { Effect } from "effect";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys } from "../redis/schema";

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
 */
export const checkCapacity = (): Effect.Effect<{ allowed: boolean; currentMachines: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		const countStr = yield* redisEffect((client) => client.get<string>(RedisKeys.countersActiveMachines));

		const currentMachines = Number(countStr || 0);
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
 * Full admission check: rate limit + capacity.
 * Returns true if a machine can be created.
 */
export const canCreateMachine = (): Effect.Effect<{ allowed: boolean; reason?: string }, RedisError, RedisService> =>
	Effect.gen(function* () {
		// Check rate limit first
		const rateOk = yield* checkRateLimit();
		if (!rateOk) {
			return { allowed: false, reason: "Rate limited (1 req/sec)" };
		}

		// Check capacity
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
 * Waits for rate limit, checks capacity, reserves slot if available.
 */
export const acquireMachineSlot = (): Effect.Effect<
	{ acquired: boolean; slotNumber?: number; reason?: string },
	RedisError,
	RedisService
> =>
	Effect.gen(function* () {
		// Wait for rate limit
		yield* waitForRateLimit();

		// Check capacity
		const { allowed, currentMachines } = yield* checkCapacity();
		if (!allowed) {
			return {
				acquired: false,
				reason: `Capacity full (${currentMachines}/${RWOS_CONFIG.MAX_MACHINES})`,
			};
		}

		// Reserve slot
		const slotNumber = yield* reserveMachineSlot();

		// Double-check we didn't exceed limit (race condition protection)
		if (slotNumber > RWOS_CONFIG.MAX_MACHINES) {
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
 */
export const getAdmissionStats = (): Effect.Effect<{ activeMachines: number; maxMachines: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		const countStr = yield* redisEffect((client) => client.get<string>(RedisKeys.countersActiveMachines));

		return {
			activeMachines: Number(countStr || 0),
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
		};
	});
