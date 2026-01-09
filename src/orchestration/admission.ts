/**
 * Admission Controller for RWOS
 *
 * Enforces rate limiting (1 req/sec for Fly API) and capacity limits.
 * Prevents overloading Fly Machines API and controls costs.
 */

import { Effect } from "effect";
import { LoggerService } from "../../packages/logger";
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
export const checkRateLimit = (): Effect.Effect<boolean, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
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

		const allowed = count <= 1;
		yield* logger.info("Rate limit check", { count, allowed });
		return allowed;
	});

/**
 * Wait for rate limit slot (blocking with retry).
 */
export const waitForRateLimit = (): Effect.Effect<void, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		let allowed = yield* checkRateLimit();

		while (!allowed) {
			yield* Effect.sleep("1 second");
			allowed = yield* checkRateLimit();
		}
	});

/**
 * Check if we have capacity to create a new machine.
 * Uses counter which tracks all machines (running + stopped) + in-flight creations.
 */
export const checkCapacity = (): Effect.Effect<{ allowed: boolean; currentMachines: number }, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		// Read current counter value (includes in-flight reservations)
		const currentSlots = yield* redisEffect((client) => client.get<number>(RedisKeys.countersActiveMachines));
		const currentMachines = currentSlots || 0;
		const allowed = currentMachines < RWOS_CONFIG.MAX_MACHINES;

		yield* logger.info("Capacity check (counter-based)", {
			currentMachines,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
			allowed,
		});

		return { allowed, currentMachines };
	});

/**
 * Reserve a machine slot (increment counter).
 */
export const reserveMachineSlot = (): Effect.Effect<number, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const slotNumber = yield* redisEffect((client) => client.incr(RedisKeys.countersActiveMachines));
		yield* logger.info("Machine slot reserved", { slotNumber });
		return slotNumber;
	});

/**
 * Release a machine slot (decrement counter).
 */
export const releaseMachineSlot = (): Effect.Effect<number, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
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

		yield* logger.info("Machine slot released", { remainingCount: count });
		return count;
	});

/**
 * Full admission check: capacity only (Fly handles rate limiting with 429s).
 * Returns true if a machine can be created.
 * Note: This is a non-atomic check - use acquireMachineSlot for atomic reservation.
 */
export const canCreateMachine = (): Effect.Effect<{ allowed: boolean; reason?: string }, RedisError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		// Read current counter value (includes in-flight reservations)
		const currentSlots = yield* redisEffect((client) => client.get<number>(RedisKeys.countersActiveMachines));
		const currentCount = currentSlots || 0;
		const allowed = currentCount < RWOS_CONFIG.MAX_MACHINES;

		yield* logger.info("Capacity check (counter-based)", {
			currentSlots: currentCount,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
			allowed,
		});

		if (!allowed) {
			return {
				allowed: false,
				reason: `Capacity full (${currentCount}/${RWOS_CONFIG.MAX_MACHINES})`,
			};
		}

		return { allowed: true };
	});

/**
 * Attempt to acquire a machine slot with admission control.
 * Uses atomic INCR to prevent race conditions - each request gets a unique slot number.
 * If the slot number exceeds MAX_MACHINES, immediately releases and rejects.
 */
export const acquireMachineSlot = (): Effect.Effect<
	{ acquired: boolean; slotNumber?: number; reason?: string },
	RedisError,
	RedisService | LoggerService
> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		yield* logger.info("Attempting to acquire machine slot (atomic)");

		// ATOMIC: Increment counter first to reserve slot
		// This ensures each concurrent request gets a unique slot number
		const slotNumber = yield* redisEffect((client) => client.incr(RedisKeys.countersActiveMachines));

		yield* logger.info("Slot number assigned", {
			slotNumber,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
		});

		// Check if we exceeded the limit
		if (slotNumber > RWOS_CONFIG.MAX_MACHINES) {
			// Over capacity - release slot and reject
			yield* logger.warn("Admission control: capacity full (atomic check)", {
				slotNumber,
				maxMachines: RWOS_CONFIG.MAX_MACHINES,
			});
			yield* releaseMachineSlot();
			return {
				acquired: false,
				reason: `Capacity full (${slotNumber - 1}/${RWOS_CONFIG.MAX_MACHINES})`,
			};
		}

		yield* logger.info("Machine slot acquired successfully", { slotNumber });
		return { acquired: true, slotNumber };
	});

/**
 * Get current admission stats for monitoring.
 * Returns counter value (includes in-flight reservations) and max machines.
 */
export const getAdmissionStats = (): Effect.Effect<{ activeMachines: number; maxMachines: number }, RedisError, RedisService> =>
	Effect.gen(function* () {
		// Use counter for accurate tracking (includes in-flight machine creations)
		const currentSlots = yield* redisEffect((client) => client.get<number>(RedisKeys.countersActiveMachines));

		return {
			activeMachines: currentSlots || 0,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
		};
	});
