/**
 * Machine Spawner for RWOS
 *
 * Creates Fly Machines with exponential backoff and Redis env injection.
 * Respects Fly API rate limits via admission controller.
 */

import { Console, Effect, Schedule } from "effect";
import { flyClient } from "../../fly/fly-client";
import type { CreateMachineRequest, Machine } from "../../fly/fly-machine-apis";
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

// =============================================================================
// Dev Mode Detection
// =============================================================================

/**
 * Check if we're in dev mode (local development with Docker worker).
 * In dev mode, we skip machine spawning and let the local Docker worker handle jobs.
 */
const isDevMode = (config: SpawnConfig): boolean => {
	// Check if FLY_API_TOKEN is missing or if we're explicitly in dev mode
	// In dev, the Docker worker runs locally and picks up jobs from Redis
	return !config.flyApiToken || config.flyApiToken === "" || process.env.NODE_ENV === "development";
};

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
const createMachine = (config: SpawnConfig, machineRequest: CreateMachineRequest): Effect.Effect<SpawnResult, SpawnerError, never> =>
	Effect.gen(function* () {
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
		});

		if (!machine.data?.id) {
			return yield* Effect.fail({
				_tag: "FlyApiError" as const,
				status: 0,
				body: "Invalid machine response: missing id",
			});
		}

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
export const spawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult, SpawnerError, RedisService> =>
	Effect.gen(function* () {
		// First, try to reuse a stopped machine
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
			yield* Console.log(`[Spawner] Reusing stopped machine ${stoppedMachineId}`);

			// Start the stopped machine
			yield* startMachine(stoppedMachineId, {
				apiToken: config.flyApiToken,
				appName: config.flyAppName,
			}).pipe(
				Effect.catchAll((err) =>
					Effect.gen(function* () {
						yield* Console.error(`[Spawner] Failed to start stopped machine ${stoppedMachineId}: ${err}`);
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

			return {
				machineId: stoppedMachineId,
				state: "started",
			} as SpawnResult;
		}

		// No stopped machines available, check admission and create new
		const slot = yield* acquireMachineSlot();

		if (!slot.acquired) {
			return yield* Effect.fail({
				_tag: "CapacityFull" as const,
				reason: slot.reason || "No capacity",
			});
		}

		yield* Console.log(`[Spawner] Acquired slot ${slot.slotNumber}, creating new machine`);

		// Build machine request with Redis credentials
		const machineRequest: CreateMachineRequest = {
			name: `ffmpeg-worker-${Date.now()}`,
			region: config.flyRegion,
			config: {
				image: `registry.fly.io/${config.flyAppName}:latest`,
				env: {
					// Redis credentials for worker
					UPSTASH_REDIS_REST_URL: config.redisUrl,
					UPSTASH_REDIS_REST_TOKEN: config.redisToken,
					// Webhook base URL
					WEBHOOK_URL: `${config.webhookBaseUrl}/webhooks/job-complete`,
				},
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

		// Create machine with retry on rate limit/5xx
		const result = yield* createMachine(config, machineRequest).pipe(
			Effect.retry(retrySchedule),
			Effect.catchAll((err) =>
				Effect.gen(function* () {
					// Release slot on failure
					yield* releaseMachineSlot();
					return yield* Effect.fail(err);
				}),
			),
		);

		yield* Console.log(`[Spawner] Created machine ${result.machineId}`);

		// Add to machine pool
		yield* addMachineToPool(result.machineId);

		return result;
	});

/**
 * Check if we should spawn a new worker.
 * Called when a new job is enqueued.
 * In dev mode, skips spawning and lets the local Docker worker handle jobs.
 */
export const maybeSpawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult | null, SpawnerError, RedisService> =>
	Effect.gen(function* () {
		// Skip machine spawning in dev mode - local Docker worker will handle jobs
		if (isDevMode(config)) {
			yield* Console.log("[Spawner] Dev mode: Skipping machine spawn (local Docker worker will handle jobs)");
			return null;
		}

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

		if (poolSize >= RWOS_CONFIG.MAX_MACHINES) {
			yield* Console.log(`[Spawner] At capacity (${poolSize}/${RWOS_CONFIG.MAX_MACHINES})`);
			return null;
		}

		// Try to spawn
		return yield* spawnWorker(config).pipe(Effect.catchTag("CapacityFull", () => Effect.succeed(null)));
	});
