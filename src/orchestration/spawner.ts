/**
 * Machine Spawner for RWOS
 *
 * Creates Fly Machines with exponential backoff and Redis env injection.
 * Respects Fly API rate limits via admission controller.
 */

import { Console, Effect, Schedule } from "effect";
import { type RedisError, RedisService, redisEffect } from "../redis/client";
import { RWOS_CONFIG, RedisKeys } from "../redis/schema";
import { acquireMachineSlot, releaseMachineSlot } from "./admission";

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

const FLY_API_BASE = "https://api.machines.dev/v1";

interface MachineConfig {
	name: string;
	region: string;
	config: {
		image: string;
		env: Record<string, string>;
		guest: {
			cpu_kind: string;
			cpus: number;
			memory_mb: number;
		};
		restart: {
			policy: string;
		};
		auto_destroy: boolean;
	};
}

/**
 * Create a Fly Machine via REST API with retry.
 */
const createMachine = (config: SpawnConfig, machineConfig: MachineConfig): Effect.Effect<SpawnResult, SpawnerError, never> =>
	Effect.gen(function* () {
		const url = `${FLY_API_BASE}/apps/${config.flyAppName}/machines`;

		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(url, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${config.flyApiToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(machineConfig),
				}),
			catch: (e) => ({
				_tag: "FlyApiError" as const,
				status: 0,
				body: e instanceof Error ? e.message : String(e),
			}),
		});

		if (!response.ok) {
			const body = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: () => "Unknown error",
			});

			return yield* Effect.fail({
				_tag: "FlyApiError" as const,
				status: response.status,
				body: typeof body === "string" ? body : "Unknown error",
			});
		}

		const data = yield* Effect.tryPromise({
			try: () => response.json() as Promise<{ id: string; state: string }>,
			catch: (e) => ({
				_tag: "FlyApiError" as const,
				status: 0,
				body: e instanceof Error ? e.message : String(e),
			}),
		});

		return { machineId: data.id, state: data.state };
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
 * Handles admission control, retry with backoff, and env injection.
 */
export const spawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult, SpawnerError, RedisService> =>
	Effect.gen(function* () {
		// Check admission (rate limit + capacity)
		const slot = yield* acquireMachineSlot();

		if (!slot.acquired) {
			return yield* Effect.fail({
				_tag: "CapacityFull" as const,
				reason: slot.reason || "No capacity",
			});
		}

		yield* Console.log(`[Spawner] Acquired slot ${slot.slotNumber}`);

		// Build machine config with Redis credentials
		const machineConfig: MachineConfig = {
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
				auto_destroy: true,
			},
		};

		// Create machine with retry on rate limit/5xx
		const result = yield* createMachine(config, machineConfig).pipe(
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

		// Register lease immediately (as per Admission Control diagram)
		const now = Date.now();
		const expiresAt = now + RWOS_CONFIG.MACHINE_TTL_MS + RWOS_CONFIG.LEASE_BUFFER_MS;

		yield* redisEffect(async (client) => {
			const pipe = client.pipeline();
			pipe.hset(RedisKeys.workersLeases, {
				[result.machineId]: String(expiresAt),
			});
			pipe.hset(RedisKeys.workerMeta(result.machineId), {
				machineId: result.machineId,
				startedAt: String(now),
				jobsProcessed: "0",
				status: "starting",
			});
			await pipe.exec();
		});

		yield* Console.log(`[Spawner] Registered lease for ${result.machineId}`);

		return result;
	});

/**
 * Check if we should spawn a new worker.
 * Called when a new job is enqueued.
 */
export const maybeSpawnWorker = (config: SpawnConfig): Effect.Effect<SpawnResult | null, SpawnerError, RedisService> =>
	Effect.gen(function* () {
		// Quick capacity check without reserving
		const { client } = yield* RedisService;

		const activeCount = yield* Effect.tryPromise({
			try: async () => {
				const count = await client.get<string>("counters:active_machines");
				return Number(count || 0);
			},
			catch: (e) => ({
				_tag: "CommandError" as const,
				reason: e instanceof Error ? e.message : String(e),
			}),
		});

		if (activeCount >= RWOS_CONFIG.MAX_MACHINES) {
			yield* Console.log(`[Spawner] At capacity (${activeCount}/${RWOS_CONFIG.MAX_MACHINES})`);
			return null;
		}

		// Try to spawn
		return yield* spawnWorker(config).pipe(Effect.catchTag("CapacityFull", () => Effect.succeed(null)));
	});
