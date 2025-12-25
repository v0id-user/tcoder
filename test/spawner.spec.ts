/**
 * Tests for Machine Spawner
 *
 * Tests worker spawning logic: dev mode detection, capacity checks,
 * stopped machine reuse, new machine creation, and error handling.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type SpawnConfig, maybeSpawnWorker, spawnWorker } from "../src/orchestration/spawner";
import { RWOS_CONFIG, RedisKeys } from "../src/redis/schema";
import {
	MockRedis,
	createMockRedisLayer,
	createTestMachinePoolEntry,
	extractErrorFromExit,
	runWithMockRedis,
	runWithMockRedisExit,
} from "./test-helpers";
import { serializeMachinePoolEntry } from "../src/redis/schema";

// Mock fly-client module
vi.mock("../fly/fly-client", () => {
	const mockFlyClient = {
		Machines_create: vi.fn(),
		Machines_start: vi.fn(),
	};

	return {
		flyClient: mockFlyClient,
	};
});

// Import after mocking
import { flyClient } from "../fly/fly-client";

describe("Spawner", () => {
	let mockRedis: MockRedis;
	const baseConfig: SpawnConfig = {
		flyApiToken: "test-token",
		flyAppName: "test-app",
		flyRegion: "iad",
		redisUrl: "https://redis.example.com",
		redisToken: "token",
		webhookBaseUrl: "https://example.com",
	};

	beforeEach(() => {
		mockRedis = new MockRedis();
		vi.clearAllMocks();
		// Reset process.env.NODE_ENV if it was set
		const originalEnv = process.env.NODE_ENV;
		if (originalEnv) {
			// @ts-expect-error - NODE_ENV can be set to undefined for testing
			process.env.NODE_ENV = undefined;
		}
	});

	describe("maybeSpawnWorker - Dev Mode", () => {
		it("skips spawning when FLY_API_TOKEN is empty", async () => {
			const config: SpawnConfig = {
				...baseConfig,
				flyApiToken: "",
			};

			const result = await runWithMockRedis(maybeSpawnWorker(config), mockRedis);
			expect(result).toBeNull();
		});

		it("skips spawning when NODE_ENV is development", async () => {
			process.env.NODE_ENV = "development";
			const result = await runWithMockRedis(maybeSpawnWorker(baseConfig), mockRedis);
			expect(result).toBeNull();
		});
	});

	describe("maybeSpawnWorker - Capacity Checks", () => {
		it("skips spawning when at max capacity", async () => {
			// Fill pool to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;

			for (let i = 0; i < maxMachines; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: serializeMachinePoolEntry(
						createTestMachinePoolEntry({
							machineId,
							state: "running",
						}),
					),
				});
			}

			const result = await runWithMockRedis(maybeSpawnWorker(baseConfig), mockRedis);
			expect(result).toBeNull();
		});
	});

	describe("spawnWorker - Stopped Machine Reuse", () => {
		it("reuses stopped machine when available", async () => {
			const stoppedMachineId = "stopped-machine";

			// Setup: stopped machine exists in stopped set
			await mockRedis.sadd(RedisKeys.machinesStopped, stoppedMachineId);
			await mockRedis.hset(RedisKeys.machinesPool, {
				[stoppedMachineId]: serializeMachinePoolEntry(
					createTestMachinePoolEntry({
						machineId: stoppedMachineId,
						state: "stopped",
					}),
				),
			});

			// Mock start machine API call
			// biome-ignore lint/suspicious/noExplicitAny: Mock function requires any
			(flyClient.Machines_start as any).mockResolvedValue({} as never);

			const result = await runWithMockRedis(spawnWorker(baseConfig), mockRedis);

			expect(result).not.toBeNull();
			if (result) {
				expect(result.machineId).toBe(stoppedMachineId);
				expect(result.state).toBe("started");
			}

			// Verify machine removed from stopped set
			const stopped = await mockRedis.smembers(RedisKeys.machinesStopped);
			expect(stopped).not.toContain(stoppedMachineId);
		});
	});

	describe("spawnWorker - New Machine Creation", () => {
		it("creates new machine when no stopped machines available", async () => {
			// No stopped machines in set
			const newMachineId = "new-machine-456";
			// biome-ignore lint/suspicious/noExplicitAny: Mock function requires any
			(flyClient.Machines_create as any).mockResolvedValue({
				data: {
					id: newMachineId,
					state: "started",
				},
			} as never);

			const result = await runWithMockRedis(spawnWorker(baseConfig), mockRedis);

			expect(result).not.toBeNull();
			if (result) {
				expect(result.machineId).toBe(newMachineId);
			}

			expect(flyClient.Machines_create).toHaveBeenCalled();

			// Verify machine added to pool
			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, newMachineId);
			expect(poolEntry).not.toBeNull();
		});

		it("fails when capacity is full", async () => {
			// Fill pool to max capacity
			const maxMachines = RWOS_CONFIG.MAX_MACHINES;

			for (let i = 0; i < maxMachines; i++) {
				const machineId = `machine-${i}`;
				await mockRedis.hset(RedisKeys.machinesPool, {
					[machineId]: serializeMachinePoolEntry(
						createTestMachinePoolEntry({
							machineId,
							state: "running",
						}),
					),
				});
			}

			const exit = await runWithMockRedisExit(spawnWorker(baseConfig), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("CapacityFull");
			}
		});

		it("releases slot on creation failure", async () => {
			// No stopped machines
			// Mock creation failure
			const error = new Error("Creation failed") as Error & { response?: { status: number; data: string } };
			error.response = { status: 500, data: "Internal Server Error" };
			// biome-ignore lint/suspicious/noExplicitAny: Mock function requires any
			(flyClient.Machines_create as any).mockRejectedValue(error);

			const exit = await runWithMockRedisExit(spawnWorker(baseConfig), mockRedis);
			const err = extractErrorFromExit(exit);

			expect(err).not.toBeNull();
			if (err && typeof err === "object" && "_tag" in err) {
				expect(err._tag).toBe("FlyApiError");
			}

			// Slot should be released (counter decremented)
			const count = await mockRedis.get<number>(RedisKeys.countersActiveMachines);
			// Should be 0 or less (released)
			expect(count).toBeLessThanOrEqual(0);
		});
	});

	describe("Error Handling", () => {
		it("handles Fly API 429 (rate limit) errors", async () => {
			// No stopped machines
			const rateLimitError = new Error("Rate limited") as Error & { response?: { status: number; data: string } };
			rateLimitError.response = { status: 429, data: "Too Many Requests" };
			// biome-ignore lint/suspicious/noExplicitAny: Mock function requires any
			(flyClient.Machines_create as any).mockRejectedValue(rateLimitError);

			const exit = await runWithMockRedisExit(spawnWorker(baseConfig), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("FlyApiError");
				if ("status" in error) {
					expect(error.status).toBe(429);
				}
			}
		});

		it("handles Fly API 5xx errors", async () => {
			// No stopped machines
			const serverError = new Error("Server error") as Error & { response?: { status: number; data: string } };
			serverError.response = { status: 503, data: "Service Unavailable" };
			// biome-ignore lint/suspicious/noExplicitAny: Mock function requires any
			(flyClient.Machines_create as any).mockRejectedValue(serverError);

			const exit = await runWithMockRedisExit(spawnWorker(baseConfig), mockRedis);
			const error = extractErrorFromExit(exit);

			expect(error).not.toBeNull();
			if (error && typeof error === "object" && "_tag" in error) {
				expect(error._tag).toBe("FlyApiError");
			}
		});
	});
});
