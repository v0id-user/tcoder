/**
 * Machine Spawner for RWOS
 *
 * Creates Fly Machines with exponential backoff and Redis env injection.
 * Respects Fly API rate limits via admission controller.
 */

import { Effect, Schedule } from "effect";
import { flyClient } from "../../fly/fly-client";
import type { Components } from "../../fly/fly-machine-apis";
import { LoggerService } from "../../packages/logger";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys } from "../redis/schema";
import { acquireMachineSlot, releaseMachineSlot } from "./admission";
import { addMachineToPool, popStoppedMachine, startMachine } from "./machine-pool";

// =============================================================================
// Types
// =============================================================================

export interface SpawnConfig {
	readonly flyApiToken: string;
	readonly flyAppName: string;
	readonly flyRegion: string;
	readonly redisUrl: string;
	readonly redisToken: string;
	readonly webhookBaseUrl: string;
}

export interface SpawnResult {
	readonly machineId: string;
	readonly state: string;
}

export type SpawnerError =
	| RedisError
	| { readonly _tag: "CapacityFull"; readonly reason: string }
	| { readonly _tag: "FlyApiError"; readonly status: number; readonly body: string }
	| { readonly _tag: "SpawnTimeout" };

// =============================================================================
// Fly Machines API
// =============================================================================

/**
 * Create a Fly Machine via typed API client.
 */
const createMachine = (
	config: SpawnConfig,
	machineRequest: Components.Schemas.CreateMachineRequest,
): Effect.Effect<SpawnResult, SpawnerError, LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		yield* logger.info("Creating Fly machine", {
			name: machineRequest.name,
			region: machineRequest.region,
			image: machineRequest.config?.image,
		});

		const machine = yield* Effect.tryPromise({
			try: () =>
				flyClient.Machines_create({ app_name: config.flyAppName }, machineRequest, {
					headers: {
						Authorization: `Bearer ${config.flyApiToken}`,
					},
				}),
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
						_tag: "FlyApiError" as const,
						status: e.response.status as number,
						body: typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data),
					} as SpawnerError;
				}
				return {
					_tag: "FlyApiError" as const,
					status: 0,
					body: typeof e === "string" ? e : "Network error",
				} as SpawnerError;
			},
		}).pipe(
			Effect.catchAll((err) =>
				Effect.gen(function* () {
					if (err._tag === "FlyApiError") {
						yield* logger.error("Fly API error creating machine", err, {
							status: err.status,
							body: err.body,
						});
					} else {
						yield* logger.error("Unexpected error creating machine", err);
					}
					return yield* Effect.fail(err);
				}),
			),
		);

		if (!machine.data?.id) {
			yield* logger.error("Invalid machine response: missing id", undefined, { response: machine.data });
			return yield* Effect.fail({
				_tag: "FlyApiError" as const,
				status: 0,
				body: "Invalid machine response: missing id",
			});
		}

		yield* logger.info("Machine created successfully", {
			machineId: machine.data.id,
			state: machine.data.state || "created",
		});

		return {
			machineId: machine.data.id,
			state: machine.data.state || "created",
		};
	});

/**
 * Exponential backoff schedule for Fly API retries.
 * Retries on 429 (rate limit) and 5xx errors.
 */
const retrySchedule = Schedule.exponential(RWOS_CONFIG.BACKOFF_BASE_MS).pipe(
	Schedule.intersect(Schedule.recurs(5)),
	Schedule.whileInput<SpawnerError>((err) => err._tag === "FlyApiError" && (err.status === 429 || err.status >= 500)),
);

// =============================================================================
// Spawner Operations
// =============================================================================

/**
 * Spawn a new Fly Machine worker.
 * First checks for stopped machines to reuse, then creates new if needed.
 * Handles admission control, retry with backoff, and env injection.
 */
export const spawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult, SpawnerError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		yield* logger.info("Starting spawnWorker", { region: config.flyRegion, appName: config.flyAppName });

		// First, try to reuse a stopped machine
		yield* logger.info("Checking for stopped machines to reuse");
		const stoppedMachineId = yield* popStoppedMachine().pipe(
			Effect.mapError(
				(err) =>
					({
						_tag: "FlyApiError" as const,
						status: 0,
						body: err._tag === "CommandError" ? err.reason : "Redis error",
					}) as SpawnerError,
			),
		);

		if (stoppedMachineId) {
			yield* logger.info("Found stopped machine to reuse", { machineId: stoppedMachineId });

			// Start the stopped machine
			yield* startMachine(stoppedMachineId, {
				apiToken: config.flyApiToken,
				appName: config.flyAppName,
			}).pipe(
				Effect.catchAll((err) =>
					Effect.gen(function* () {
						yield* logger.error("Failed to start stopped machine", err, {
							machineId: stoppedMachineId,
							errorType: err._tag,
							status: err._tag === "HttpError" ? err.status : undefined,
							body: err._tag === "HttpError" ? err.body : undefined,
						});
						// Put it back in stopped set if start failed
						yield* redisEffect((client) => client.sadd(RedisKeys.machinesStopped, stoppedMachineId));
						return yield* Effect.fail({
							_tag: "FlyApiError" as const,
							status: err._tag === "HttpError" ? err.status : 0,
							body: err._tag === "HttpError" ? err.body : "Failed to start machine",
						} as SpawnerError);
					}),
				),
			);

			yield* logger.info("Successfully started stopped machine", { machineId: stoppedMachineId });
			return {
				machineId: stoppedMachineId,
				state: "started",
			} as SpawnResult;
		}

		yield* logger.info("No stopped machines available, checking admission control");

		// No stopped machines available, check admission and create new
		const slot = yield* acquireMachineSlot();

		if (!slot.acquired) {
			yield* logger.warn("Admission control rejected: capacity full", {
				reason: slot.reason || "No capacity",
			});
			return yield* Effect.fail({
				_tag: "CapacityFull" as const,
				reason: slot.reason || "No capacity",
			});
		}

		yield* logger.info("Admission control passed, acquired slot", { slotNumber: slot.slotNumber });

		// Build machine request with Redis credentials
		const env: Record<string, string> = {
			// Redis credentials for worker
			UPSTASH_REDIS_REST_URL: config.redisUrl,
			UPSTASH_REDIS_REST_TOKEN: config.redisToken,
		};

		// Only set WEBHOOK_URL if provided (optional)
		if (config.webhookBaseUrl) {
			env.WEBHOOK_URL = config.webhookBaseUrl;
		}

		const machineRequest: Components.Schemas.CreateMachineRequest = {
			name: `ffmpeg-worker-${Date.now()}`,
			region: config.flyRegion,
			config: {
				image: "registry.fly.io/fly-tcoder-ffmpeg-worker-31657fa:deployment-01KDP0T010DRW73GA6RN47JSWW",
				env,
				guest: {
					cpu_kind: "shared",
					cpus: 1,
					memory_mb: 512,
				},
				restart: {
					policy: "no",
				},
				auto_destroy: false,
			},
		};

		yield* logger.info("Creating new machine", {
			name: machineRequest.name,
			region: machineRequest.region,
			image: machineRequest.config?.image,
		});

		// Create machine with retry on rate limit/5xx
		const result = yield* createMachine(config, machineRequest).pipe(
			Effect.retry(retrySchedule),
			Effect.catchAll((err) =>
				Effect.gen(function* () {
					yield* logger.error("Machine creation failed after retries, releasing slot", err, {
						slotNumber: slot.slotNumber,
						errorType: err._tag,
						status: err._tag === "FlyApiError" ? err.status : undefined,
						body: err._tag === "FlyApiError" ? err.body : undefined,
					});
					// Release slot on failure
					yield* releaseMachineSlot();
					return yield* Effect.fail(err);
				}),
			),
		);

		yield* logger.info("Machine created successfully, adding to pool", {
			machineId: result.machineId,
			state: result.state,
		});

		// Add to machine pool
		yield* addMachineToPool(result.machineId).pipe(
			Effect.catchAll((err) =>
				Effect.gen(function* () {
					yield* logger.error("Failed to add machine to pool", err, { machineId: result.machineId });
					// Don't fail the spawn, just log the error
					return Effect.void;
				}),
			),
		);

		yield* logger.info("SpawnWorker completed successfully", {
			machineId: result.machineId,
			state: result.state,
		});

		return result;
	});

/**
 * Check if we should spawn a new worker.
 * Called when a new job is enqueued.
 */
export const maybeSpawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult | null, SpawnerError, RedisService | LoggerService> =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		yield* logger.info("maybeSpawnWorker: checking if worker should be spawned");

		// Quick capacity check without reserving
		const { client } = yield* RedisService;

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

		const poolSize = Object.keys(poolEntries).length;

		yield* logger.info("Capacity check", {
			currentMachines: poolSize,
			maxMachines: RWOS_CONFIG.MAX_MACHINES,
			atCapacity: poolSize >= RWOS_CONFIG.MAX_MACHINES,
		});

		if (poolSize >= RWOS_CONFIG.MAX_MACHINES) {
			yield* logger.info("At capacity, not spawning worker", {
				currentMachines: poolSize,
				maxMachines: RWOS_CONFIG.MAX_MACHINES,
			});
			return null;
		}

		yield* logger.info("Capacity available, attempting to spawn worker");

		// Try to spawn
		return yield* spawnWorker(config).pipe(
			Effect.catchTag("CapacityFull", (err) =>
				Effect.gen(function* () {
					yield* logger.warn("Spawn failed: capacity full", { reason: err.reason });
					return null;
				}),
			),
			Effect.catchAll((err) =>
				Effect.gen(function* () {
					if (err._tag === "FlyApiError") {
						yield* logger.error("Spawn failed: Fly API error", err, {
							status: err.status,
							body: err.body,
						});
					} else {
						yield* logger.error("Spawn failed with error", err, {
							errorType: err._tag,
						});
					}
					return yield* Effect.fail(err);
				}),
			),
		);
	});
