/**
 * Machine Pool Management for RWOS
 *
 * Handles starting/stopping machines and syncing pool state with Fly API.
 * Machines are pooled: stopped machines can be restarted instead of creating new ones.
 */

import { Console, Effect } from "effect";
import { flyClient } from "../../fly/fly-client";
import type { Machine } from "../../fly/fly-machine-apis";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys, serializeMachinePoolEntry, deserializeMachinePoolEntry } from "../redis/schema";

// =============================================================================
// Types
// =============================================================================

export type FlyApiError =
	| { readonly _tag: "HttpError"; readonly status: number; readonly body: string }
	| { readonly _tag: "InvalidMachineResponse"; readonly raw: unknown }
	| RedisError;

interface FlyConfig {
	readonly apiToken: string;
	readonly appName: string;
}

// =============================================================================
// Fly API Helpers
// =============================================================================

const callFlyApi = <T>(operation: (config: FlyConfig) => Promise<T>, config: FlyConfig): Effect.Effect<T, FlyApiError, never> =>
	Effect.tryPromise({
		try: () => operation(config),
		catch: (e) => {
			if (
				e &&
				typeof e === "object" &&
				"response" in e &&
				e.response &&
				typeof e.response === "object" &&
				"status" in e.response &&
				"data" in e.response
			) {
				return {
					_tag: "HttpError" as const,
					status: e.response.status as number,
					body: typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data),
				};
			}
			return {
				_tag: "HttpError" as const,
				status: 0,
				body: typeof e === "string" ? e : "Network error",
			};
		},
	});

// =============================================================================
// Machine Pool Operations
// =============================================================================

/**
 * Start a stopped machine via Fly API.
 */
export const startMachine = (machineId: string, config: FlyConfig): Effect.Effect<void, FlyApiError, RedisService> =>
	Effect.gen(function* () {
		yield* Console.log(`[MachinePool] Starting machine ${machineId}`);

		// Call Fly API to start machine
		yield* callFlyApi(async (cfg) => {
			await flyClient.Machines_start(
				{
					app_name: cfg.appName,
					machine_id: machineId,
				},
				undefined,
				{
					headers: {
						Authorization: `Bearer ${cfg.apiToken}`,
					},
				},
			);
		}, config);

		// Update pool state: remove from stopped set, update pool entry to running
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing pool entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					return deserializeMachinePoolEntry(machineId, data);
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;

		const pipe = client.pipeline();
		// Remove from stopped set
		pipe.srem(RedisKeys.machinesStopped, machineId);
		// Update pool entry to running
		pipe.hset(RedisKeys.machinesPool, {
			[machineId]: serializeMachinePoolEntry({
				machineId,
				state: "running",
				lastActiveAt: now,
				createdAt,
			}),
		});

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* Console.log(`[MachinePool] Machine ${machineId} started and marked as running`);
	});

/**
 * Stop a running machine via Fly API.
 */
export const stopMachine = (machineId: string, config: FlyConfig): Effect.Effect<void, FlyApiError, RedisService> =>
	Effect.gen(function* () {
		yield* Console.log(`[MachinePool] Stopping machine ${machineId}`);

		// Call Fly API to stop machine
		yield* callFlyApi(async (cfg) => {
			await flyClient.Machines_stop(
				{
					app_name: cfg.appName,
					machine_id: machineId,
				},
				undefined,
				{
					headers: {
						Authorization: `Bearer ${cfg.apiToken}`,
					},
				},
			);
		}, config);

		// Update pool state: add to stopped set, update pool entry to stopped
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing pool entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					return deserializeMachinePoolEntry(machineId, data);
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;

		const pipe = client.pipeline();
		// Add to stopped set
		pipe.sadd(RedisKeys.machinesStopped, machineId);
		// Update pool entry to stopped
		pipe.hset(RedisKeys.machinesPool, {
			[machineId]: serializeMachinePoolEntry({
				machineId,
				state: "stopped",
				lastActiveAt: now,
				createdAt,
			}),
		});

		yield* Effect.tryPromise({
			try: () => pipe.exec(),
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		yield* Console.log(`[MachinePool] Machine ${machineId} stopped and added to stopped set`);
	});

/**
 * Sync machine pool state with Fly API.
 * Called on startup/recovery to ensure Redis matches actual Fly machine states.
 */
export const syncMachinePool = (config: FlyConfig): Effect.Effect<void, FlyApiError, RedisService> =>
	Effect.gen(function* () {
		yield* Console.log("[MachinePool] Syncing pool state with Fly API...");

		// Get all machines from Fly API
		const machines = yield* callFlyApi(async (cfg) => {
			const response = await flyClient.Machines_list(
				{
					app_name: cfg.appName,
				},
				undefined,
				{
					headers: {
						Authorization: `Bearer ${cfg.apiToken}`,
					},
				},
			);
			return (response.data as { machines?: Machine[] })?.machines || [];
		}, config);

		yield* Console.log(`[MachinePool] Found ${machines.length} machines in Fly`);

		const { client } = yield* RedisService;
		const now = Date.now();

		// Get current pool state
		const poolEntries = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hgetall<Record<string, string>>(RedisKeys.machinesPool);
				return data || {};
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const stoppedSet = yield* Effect.tryPromise({
			try: async () => {
				const members = await client.smembers(RedisKeys.machinesStopped);
				// Upstash returns array or null
				const memberArray = Array.isArray(members) ? members : members ? [members] : [];
				return new Set(memberArray.map(String));
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		// Build map of Fly machines by ID
		const flyMachines = new Map<string, Machine>();
		for (const machine of machines) {
			if (machine.id) {
				flyMachines.set(machine.id, machine);
			}
		}

		// Update pool entries based on Fly state
		const pipe = client.pipeline();
		let updated = 0;

		for (const [machineId, machine] of flyMachines.entries()) {
			const existingEntry = poolEntries[machineId] ? deserializeMachinePoolEntry(machineId, poolEntries[machineId]) : null;

			const createdAt = existingEntry?.createdAt || now;
			const flyState = machine.state || "unknown";

			// Determine state: if Fly says stopped, mark as stopped; otherwise running
			const poolState = flyState === "stopped" ? "stopped" : "running";

			pipe.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry({
					machineId,
					state: poolState,
					lastActiveAt: existingEntry?.lastActiveAt || now,
					createdAt,
				}),
			});

			if (poolState === "stopped") {
				pipe.sadd(RedisKeys.machinesStopped, machineId);
			} else {
				pipe.srem(RedisKeys.machinesStopped, machineId);
			}

			updated++;
		}

		// Remove machines from pool that no longer exist in Fly
		const poolMachineIds = new Set(Object.keys(poolEntries));
		for (const machineId of poolMachineIds) {
			if (!flyMachines.has(machineId)) {
				pipe.hdel(RedisKeys.machinesPool, machineId);
				pipe.srem(RedisKeys.machinesStopped, machineId);
				updated++;
			}
		}

		if (updated > 0) {
			yield* Effect.tryPromise({
				try: () => pipe.exec(),
				catch: (e) => ({
					_tag: "CommandError" as const,
					reason: e instanceof Error ? e.message : String(e),
				}),
			});
		}

		yield* Console.log(`[MachinePool] Synced ${updated} pool entries`);
	});

/**
 * Get a stopped machine ID from the pool (pops from set).
 * Returns null if no stopped machines available.
 */
export const popStoppedMachine = (): Effect.Effect<string | null, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;

		// Use SPOP to atomically get and remove one machine from stopped set
		const machineId = yield* Effect.tryPromise({
			try: async () => {
				const result = await client.spop(RedisKeys.machinesStopped, 1);
				// Upstash returns array or single value
				if (Array.isArray(result)) {
					return result.length > 0 ? String(result[0]) : null;
				}
				return result ? String(result) : null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		return machineId;
	});

/**
 * Add a new machine to the pool.
 */
export const addMachineToPool = (machineId: string): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		yield* redisEffect((client) =>
			client.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry({
					machineId,
					state: "running",
					lastActiveAt: now,
					createdAt: now,
				}),
			}),
		);

		yield* Console.log(`[MachinePool] Added machine ${machineId} to pool`);
	});

/**
 * Update machine state in pool (running/idle).
 */
export const updateMachineState = (machineId: string, state: "running" | "idle"): Effect.Effect<void, RedisError, RedisService> =>
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		const now = Date.now();

		// Get existing entry to preserve createdAt
		const existingEntry = yield* Effect.tryPromise({
			try: async () => {
				const data = await client.hget<string>(RedisKeys.machinesPool, machineId);
				if (data) {
					return deserializeMachinePoolEntry(machineId, data);
				}
				return null;
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		const createdAt = existingEntry?.createdAt || now;

		yield* redisEffect((client) =>
			client.hset(RedisKeys.machinesPool, {
				[machineId]: serializeMachinePoolEntry({
					machineId,
					state,
					lastActiveAt: now,
					createdAt,
				}),
			}),
		);
	});
