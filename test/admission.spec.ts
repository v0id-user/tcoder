/**
 * Tests for Admission Controller
 *
 * Tests rate limiting, capacity checking, and slot acquisition logic.
 */

import { Clock, Effect } from "effect";
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
import { MockRedis, createMockRedisLayer, extractErrorFromExit, runWithMockRedis, runWithMockRedisExit } from "./test-helpers";

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

			// Should wait approximately 1 second (allow some variance)
			expect(elapsed).toBeGreaterThanOrEqual(900);
			expect(elapsed).toBeLessThan(1500);
		});
	});

	describe("checkCapacity", () => {
		it("returns true when pool is empty", async () => {
			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(true);
			expect(result.currentMachines).toBe(0);
		});

		it("returns true when below max capacity", async () => {
			// Add some machines to pool
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;
			const machinesToAdd = maxMachines - 1;

			for (let i = 0; i < machinesToAdd; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: Date.now(),
						createdAt: Date.now(),
					}),
				});
			}

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(true);
			expect(result.currentMachines).toBe(machinesToAdd);
		});

		it("returns false when at max capacity", async () => {
			// Fill pool to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;

			for (let i = 0; i < maxMachines; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: Date.now(),
						createdAt: Date.now(),
					}),
				});
			}

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.allowed).toBe(false);
			expect(result.currentMachines).toBe(maxMachines);
		});

		it("counts both running and stopped machines", async () => {
			// Add mix of running and stopped machines
			await mockRedis.hset(RedisKeys.machinesPool, {
				"machine-1": JSON.stringify({
					state: "running",
					lastActiveAt: Date.now(),
					createdAt: Date.now(),
				}),
				"machine-2": JSON.stringify({
					state: "stopped",
					lastActiveAt: Date.now(),
					createdAt: Date.now(),
				}),
				"machine-3": JSON.stringify({
					state: "idle",
					lastActiveAt: Date.now(),
					createdAt: Date.now(),
				}),
			});

			const result = await runWithMockRedis(checkCapacity(), mockRedis);
			expect(result.currentMachines).toBe(3);
		});
	});

	describe("acquireMachineSlot", () => {
		it("acquires slot when capacity available", async () => {
			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(true);
			expect(result.slotNumber).toBeGreaterThan(0);
		});

		it("fails when capacity full", async () => {
			// Fill pool to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;

			for (let i = 0; i < maxMachines; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: Date.now(),
						createdAt: Date.now(),
					}),
				});
			}

			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(false);
			expect(result.reason).toContain("Capacity full");
		});

		it("increments counter when acquiring slot", async () => {
			await runWithMockRedis(acquireMachineSlot(), mockRedis);
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBe(1);
		});

		it("releases slot if capacity exceeded after reservation", async () => {
			// Fill pool to max - 1
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;

			for (let i = 0; i < maxMachines - 1; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: Date.now(),
						createdAt: Date.now(),
					}),
				});
			}

			// Add one more machine concurrently (simulating race condition)
			const machineId = `machine-${maxMachines}`;
			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: JSON.stringify({
					state: "running",
					lastActiveAt: Date.now(),
					createdAt: Date.now(),
				}),
			});

			// Now capacity check should fail after reservation
			const result = await runWithMockRedis(acquireMachineSlot(), mockRedis);
			expect(result.acquired).toBe(false);
			expect(result.reason).toContain("Capacity exceeded");

			// Counter should be released (back to 0 or previous value)
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			expect(count).toBeLessThanOrEqual(0);
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
		it("returns correct stats for empty pool", async () => {
			const result = await runWithMockRedis(getAdmissionStats(), mockRedis);
			expect(result.activeMachines).toBe(0);
			expect(result.maxMachines).toBe(RWOS_CONFIG.MAX_MACHINES);
		});

		it("returns correct stats for populated pool", async () => {
			// Add machines to pool
			const machines = ["machine-1", "machine-2", "machine-3"];

			for (const machineId of machines) {
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: JSON.stringify({
						state: "running",
						lastActiveAt: Date.now(),
						createdAt: Date.now(),
					}),
				});
			}

			const result = await runWithMockRedis(getAdmissionStats(), mockRedis);
			expect(result.activeMachines).toBe(3);
			expect(result.maxMachines).toBe(RWOS_CONFIG.MAX_MACHINES);
		});
	});

	describe("Error Handling", () => {
		it("handles Redis connection errors gracefully", async () => {
			// Create a mock Redis that throws errors
			const errorRedis = new MockRedis();
			// Mock a method to throw an error
			const originalHgetall = errorRedis.hgetall.bind(errorRedis);
			errorRedis.hgetall = async () => {
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
