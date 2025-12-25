/**
 * Tests for Machine Pool Management
 *
 * Tests machine lifecycle operations: start, stop, sync, add, and update state.
 * Note: Fly API calls are mocked via vi.mock.
 */

import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../fly/fly-machine-apis";
import {
	addMachineToPool,
	popStoppedMachine,
	startMachine,
	stopMachine,
	syncMachinePool,
	updateMachineState,
} from "../src/orchestration/machine-pool";
import { RedisKeys, deserializeMachinePoolEntry, serializeMachinePoolEntry } from "../src/redis/schema";
import {
	MockRedis,
	createMockRedisLayer,
	createTestMachinePoolEntry,
	extractErrorFromExit,
	runWithMockRedis,
	runWithMockRedisExit,
} from "./test-helpers";

// Mock fly-client module
vi.mock("../fly/fly-client", () => {
	const mockFlyClient = {
		Machines_start: vi.fn(),
		Machines_stop: vi.fn(),
		Machines_list: vi.fn(),
	};

	return {
		flyClient: mockFlyClient,
	};
});

// Import after mocking
import { flyClient } from "../fly/fly-client";

describe("Machine Pool", () => {
	let mockRedis: MockRedis;
	const flyConfig = {
		apiToken: "test-token",
		appName: "test-app",
	};

	beforeEach(() => {
		mockRedis = new MockRedis();
		vi.clearAllMocks();
	});

	describe("startMachine", () => {
		it("starts machine and updates pool state", async () => {
			const machineId = "machine-1";
			const existingEntry = createTestMachinePoolEntry({
				machineId,
				state: "stopped",
				createdAt: 1000,
			});

			// Setup: machine exists in pool and stopped set
			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry(existingEntry),
			});
			await mockRedis.sadd(RedisKeys.machinesStopped, machineId);

			// Mock Fly API success
			vi.mocked(flyClient.Machines_start).mockResolvedValue({} as never);

			await runWithMockRedis(startMachine(machineId, flyConfig), mockRedis);

			// Verify Fly API called
			expect(flyClient.Machines_start).toHaveBeenCalledWith(
				{
					app_name: flyConfig.appName,
					machine_id: machineId,
				},
				undefined,
				{
					headers: {
						Authorization: `Bearer ${flyConfig.apiToken}`,
					},
				},
			);

			// Verify machine removed from stopped set
			const stopped = await mockRedis.smembers(RedisKeys.machinesStopped);
			expect(stopped).not.toContain(machineId);

			// Verify pool entry updated to running
			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, machineId);
			expect(poolEntry).not.toBeNull();
			if (poolEntry) {
				const entry = deserializeMachinePoolEntry(machineId, poolEntry);
				expect(entry?.state).toBe("running");
				expect(entry?.createdAt).toBe(1000); // Preserved
			}
		});

		it("handles Fly API errors", async () => {
			const machineId = "machine-error";
			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry(
					createTestMachinePoolEntry({
						machineId,
						state: "stopped",
					}),
				),
			});

			// Mock Fly API error
			const error = new Error("API Error") as Error & { response?: { status: number; data: string } };
			error.response = { status: 500, data: "Internal Server Error" };
			vi.mocked(flyClient.Machines_start).mockRejectedValue(error);

			const exit = await runWithMockRedisExit(startMachine(machineId, flyConfig), mockRedis);
			const err = extractErrorFromExit(exit);

			expect(err).not.toBeNull();
			if (err && typeof err === "object" && "_tag" in err) {
				expect(err._tag).toBe("HttpError");
			}
		});
	});

	describe("stopMachine", () => {
		it("stops machine and updates pool state", async () => {
			const machineId = "machine-2";
			const existingEntry = createTestMachinePoolEntry({
				machineId,
				state: "running",
				createdAt: 2000,
			});

			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry(existingEntry),
			});

			// Mock Fly API success
			vi.mocked(flyClient.Machines_stop).mockResolvedValue({} as never);

			await runWithMockRedis(stopMachine(machineId, flyConfig), mockRedis);

			// Verify Fly API called
			expect(flyClient.Machines_stop).toHaveBeenCalledWith(
				{
					app_name: flyConfig.appName,
					machine_id: machineId,
				},
				undefined,
				{
					headers: {
						Authorization: `Bearer ${flyConfig.apiToken}`,
					},
				},
			);

			// Verify machine added to stopped set
			const stopped = await mockRedis.smembers(RedisKeys.machinesStopped);
			expect(stopped).toContain(machineId);

			// Verify pool entry updated to stopped
			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, machineId);
			if (poolEntry) {
				const entry = deserializeMachinePoolEntry(machineId, poolEntry);
				expect(entry?.state).toBe("stopped");
				expect(entry?.createdAt).toBe(2000); // Preserved
			}
		});
	});

	describe("syncMachinePool", () => {
		it("syncs pool state with Fly API", async () => {
			const machines: Machine[] = [
				{
					id: "machine-1",
					name: "machine-1",
					state: "started",
					region: "iad",
					created_at: new Date().toISOString(),
				},
				{
					id: "machine-2",
					name: "machine-2",
					state: "stopped",
					region: "iad",
					created_at: new Date().toISOString(),
				},
			];

			// Mock Fly API response
			vi.mocked(flyClient.Machines_list).mockResolvedValue({
				data: { machines },
			} as never);

			await runWithMockRedis(syncMachinePool(flyConfig), mockRedis);

			// Verify machines added to pool
			const poolEntries = await mockRedis.hgetall<Record<string, string>>(RedisKeys.machinesPool);
			expect(poolEntries).not.toBeNull();
			expect(Object.keys(poolEntries || {})).toContain("machine-1");
			expect(Object.keys(poolEntries || {})).toContain("machine-2");

			// Verify stopped machine added to stopped set
			const stopped = await mockRedis.smembers(RedisKeys.machinesStopped);
			expect(stopped).toContain("machine-2");
			expect(stopped).not.toContain("machine-1");
		});

		it("removes machines that no longer exist in Fly", async () => {
			// Existing machine in pool
			const oldMachineId = "old-machine";
			await mockRedis.hset(RedisKeys.machinesPool, {
				[oldMachineId]: serializeMachinePoolEntry(
					createTestMachinePoolEntry({
						machineId: oldMachineId,
						state: "running",
					}),
				),
			});

			// Mock Fly API returns empty list
			vi.mocked(flyClient.Machines_list).mockResolvedValue({
				data: { machines: [] },
			} as never);

			await runWithMockRedis(syncMachinePool(flyConfig), mockRedis);

			// Verify old machine removed
			const poolEntries = await mockRedis.hgetall<Record<string, string>>(RedisKeys.machinesPool);
			expect(poolEntries?.[oldMachineId]).toBeUndefined();
		});
	});

	describe("popStoppedMachine", () => {
		it("returns null when no stopped machines", async () => {
			const result = await runWithMockRedis(popStoppedMachine(), mockRedis);
			expect(result).toBeNull();
		});

		it("atomically pops stopped machine from set", async () => {
			const machineIds = ["machine-1", "machine-2", "machine-3"];

			for (const id of machineIds) {
				await mockRedis.sadd(RedisKeys.machinesStopped, id);
			}

			const result = await runWithMockRedis(popStoppedMachine(), mockRedis);

			expect(result).toBeTruthy();
			expect(machineIds).toContain(result);

			// Verify machine removed from set
			const remaining = await mockRedis.smembers(RedisKeys.machinesStopped);
			expect(remaining).not.toContain(result);
			expect(remaining.length).toBe(2);
		});
	});

	describe("addMachineToPool", () => {
		it("adds machine to pool with running state", async () => {
			const machineId = "new-machine";

			await runWithMockRedis(addMachineToPool(machineId), mockRedis);

			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, machineId);
			expect(poolEntry).not.toBeNull();

			if (poolEntry) {
				const entry = deserializeMachinePoolEntry(machineId, poolEntry);
				expect(entry?.machineId).toBe(machineId);
				expect(entry?.state).toBe("running");
				expect(entry?.createdAt).toBeGreaterThan(0);
				expect(entry?.lastActiveAt).toBeGreaterThan(0);
			}
		});
	});

	describe("updateMachineState", () => {
		it("updates machine state to running", async () => {
			const machineId = "machine-update";
			const existingEntry = createTestMachinePoolEntry({
				machineId,
				state: "idle",
				createdAt: 3000,
			});

			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry(existingEntry),
			});

			await runWithMockRedis(updateMachineState(machineId, "running"), mockRedis);

			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, machineId);
			if (poolEntry) {
				const entry = deserializeMachinePoolEntry(machineId, poolEntry);
				expect(entry?.state).toBe("running");
				expect(entry?.createdAt).toBe(3000); // Preserved
			}
		});

		it("updates machine state to idle", async () => {
			const machineId = "machine-idle";
			await mockRedis.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry(
					createTestMachinePoolEntry({
						machineId,
						state: "running",
					}),
				),
			});

			await runWithMockRedis(updateMachineState(machineId, "idle"), mockRedis);

			const poolEntry = await mockRedis.hget<string>(RedisKeys.machinesPool, machineId);
			if (poolEntry) {
				const entry = deserializeMachinePoolEntry(machineId, poolEntry);
				expect(entry?.state).toBe("idle");
			}
		});
	});
});
