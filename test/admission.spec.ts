/**
 * Tests for Admission Controller
 *
 * Tests rate limiting, capacity checking, and slot acquisition logic.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	acquireMachineSlot,
	checkCapacity,
	checkRateLimit,
	getAdmissionStats,
	releaseMachineSlot,
	waitForRateLimit,
} from "../src/orchestration/admission";
import { RWOS_CONFIG, RedisKeys } from "../src/redis/schema";
import { MockRedis, extractErrorFromExit, runWithMockRedis, runWithMockRedisExit } from "./test-helpers";

describe("Admission Controller", () => {
	let mockRedis: MockRedis;

	beforeEach(() => {
		mockRedis = new MockRedis();
	});

	describe("checkRateLimit", () => {
		it("allows first request", async () => {
			const result = await runWithMockRedis(checkRateLimit(), mockRedis);
			expect(result).toBe(true);
		});

		it("blocks second request within 1 second", async () => {
			// First request should succeed
			const first = await runWithMockRedis(checkRateLimit(), mockRedis);
			expect(first).toBe(true);

			// Second request should fail (rate limited)
			const second = await runWithMockRedis(checkRateLimit(), mockRedis);
			expect(second).toBe(false);
		});

		it("allows request after expiration", async () => {
			// First request
			await runWithMockRedis(checkRateLimit(), mockRedis);

			// Wait for expiry (1 second + small buffer)
			await new Promise((resolve) => setTimeout(resolve, 1100));

			// Second request should succeed
			const result = await runWithMockRedis(checkRateLimit(), mockRedis);
			expect(result).toBe(true);
		});
	});

	describe("waitForRateLimit", () => {
		it("returns immediately when rate limit allows", async () => {
			const start = Date.now();
			await runWithMockRedis(waitForRateLimit(), mockRedis);
			const elapsed = Date.now() - start;
			// Should return quickly (< 100ms)
			expect(elapsed).toBeLessThan(100);
		});

		it("waits when rate limited", async () => {
			// First request (succeeds immediately)
			await runWithMockRedis(checkRateLimit(), mockRedis);

			// Second request should wait
			const start = Date.now();
			await runWithMockRedis(waitForRateLimit(), mockRedis);
			const elapsed = Date.now() - start;

			// Should wait approximately 1 second (allow some variance for test environment)
			expect(elapsed).toBeGreaterThanOrEqual(900);
			expect(elapsed).toBeLessThan(3000);
		});
	});

	describe("checkCapacity", () => {
		it("returns true when counter is zero", async () => {
			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(true);
			expect(result.currentMachines).toBe(0);
		});

		it("returns true when counter is below max capacity", async () => {
			// Set counter to max - 1
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			const currentCount = maxMachines - 1;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(currentCount));

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(true);
			expect(result.currentMachines).toBe(currentCount);
		});

		it("returns false when counter is at max capacity", async () => {
			// Set counter to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines));

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(false);
			expect(result.currentMachines).toBe(maxMachines);
		});

		it("returns false when counter exceeds max capacity", async () => {
			// Set counter above max (edge case - shouldn't happen but should be handled)
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines + 1));

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(false);
			expect(result.currentMachines).toBe(maxMachines + 1);
		});
	});

	describe("acquireMachineSlot", () => {
		it("acquires slot when counter is zero", async () => {
			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(true);
			expect(result.slotNumber).toBe(1);
		});

		it("acquires slot when counter is below max", async () => {
			// Set counter to some value below max
			await mockRedis.set(RedisKeys.countersActiveMachines, "5");

			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(true);
			expect(result.slotNumber).toBe(6);
		});

		it("fails when counter is at max capacity", async () => {
			// Set counter to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines));

			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(false);
			expect(result.reason).toContain("Capacity full");

			// Counter should be back to max (slot released)
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(maxMachines);
		});

		it("increments counter atomically when acquiring slot", async () => {
			await runWithMockRedis(acquireMachineSlot(), mockRedis);
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(1);
		});

		it("releases slot when exceeding capacity (atomic check)", async () => {
			// Set counter to max - 1, so next INCR will hit exactly max
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines - 1));

			// First acquisition should succeed (slot = max)
			const result1 = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result1.acquired).toBe(true);
			expect(result1.slotNumber).toBe(maxMachines);

			// Second acquisition should fail (slot = max + 1, exceeds limit)
			const result2 = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result2.acquired).toBe(false);
			expect(result2.reason).toContain("Capacity full");

			// Counter should be back to max (slot was released)
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(maxMachines);
		});

		it("handles concurrent slot acquisitions atomically", async () => {
			// Start with counter at max - 2
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines - 2));

			// Acquire two slots - both should succeed
			const result1 = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			const result2 = await runWithMockRedis(acquireMachineSlot(), mockRedis);

			expect(result1.acquired).toBe(true);
			expect(result2.acquired).toBe(true);
			expect(result1.slotNumber).toBe(maxMachines - 1);
			expect(result2.slotNumber).toBe(maxMachines);

			// Third acquisition should fail
			const result3 = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result3.acquired).toBe(false);

			// Counter should be at max
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(maxMachines);
		});
	});

	describe("releaseMachineSlot", () => {
		it("decrements counter", async () => {
			// Set counter to 5
			await mockRedis.set(RedisKeys.countersActiveMachines, "5");

			const result = await runWithMockRedis(releaseMachineSlot(), mockRedis);
			expect(result).toBe(4);

			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(4);
		});

		it("does not go below 0", async () => {
			// Counter at 0
			await mockRedis.set(RedisKeys.countersActiveMachines, "0");

			const result = await runWithMockRedis(releaseMachineSlot(), mockRedis);
			expect(result).toBe(0);

			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(0);
		});

		it("handles non-existent counter", async () => {
			// Counter doesn't exist
			const result = await runWithMockRedis(releaseMachineSlot(), mockRedis);
			expect(result).toBe(0);

			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(0);
		});
	});

	describe("getAdmissionStats", () => {
		it("returns correct stats for zero counter", async () => {
			const result = await runWithMockRedis(getAdmissionStats(), mockRedis);
			expect(result.activeMachines).toBe(0);
			expect(result.maxMachines).toBe(RWOS_CONFIG.MAX_MACHINES);
		});

		it("returns correct stats when counter has value", async () => {
			// Set counter to 3
			await mockRedis.set(RedisKeys.countersActiveMachines, "3");

			const result = await runWithMockRedis(getAdmissionStats(), mockRedis);
			expect(result.activeMachines).toBe(3);
			expect(result.maxMachines).toBe(RWOS_CONFIG.MAX_MACHINES);
		});

		it("returns correct stats when counter is at max", async () => {
			// Set counter to max
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			await mockRedis.set(RedisKeys.countersActiveMachines, String(maxMachines));

			const result = await runWithMockRedis(getAdmissionStats(), mockRedis);
			expect(result.activeMachines).toBe(maxMachines);
			expect(result.maxMachines).toBe(maxMachines);
		});
	});

	describe("Error Handling", () => {
		it("handles Redis connection errors gracefully", async () => {
			// Create a mock Redis that throws errors
			const errorRedis = new MockRedis();
			// Mock get method to throw an error (used by checkCapacity)
			errorRedis.get = async () => {
				throw new Error("Connection failed");
			};

			const exit = await runWithMockRedisExit(checkCapacity(), errorRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("CommandError");
			}
		});
	});
});
