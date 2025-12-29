/**
 * R2 Event Notification Handler
 *
 * Processes R2 object-create events from the queue.
 * When a video is uploaded, enqueues a transcoding job.
 */

import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../../packages/logger";
import { type SpawnConfig, maybeSpawnWorker } from "../orchestration/spawner";
import { makeRedisLayer } from "../redis/client";
import { type JobData, RWOS_CONFIG, RedisKeys, serializeJobData } from "../redis/schema";
import { extractJobIdFromKey } from "./presigned";

// =============================================================================
// R2 Event Types (from Cloudflare)
// =============================================================================

export interface R2EventNotification {
	account: string;
	bucket: string;
	object: {
		key: string;
		size: number;
		eTag: string;
	};
	action: "PutObject" | "CopyObject" | "CompleteMultipartUpload" | "DeleteObject";
	eventTime: string;
	copySource?: {
		bucket: string;
		object: string;
	};
}

export interface MessageBatch<T> {
	queue: string;
	messages: Message<T>[];
	ackAll(): void;
	retryAll(): void;
}

export interface Message<T> {
	id: string;
	timestamp: Date;
	body: T;
	ack(): void;
	retry(): void;
}

// =============================================================================
// Environment Types
// =============================================================================

export interface Env {
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
	FLY_API_TOKEN: string;
	FLY_APP_NAME: string;
	FLY_REGION: string;
	WEBHOOK_BASE_URL: string;
	R2_ACCOUNT_ID: string;
	R2_INPUT_BUCKET_NAME: string;
}

// =============================================================================
// Event Handler
// =============================================================================

/**
 * Handle R2 event notification batch.
 * Called by the queue consumer when objects are uploaded.
 */
export async function handleR2Events(batch: MessageBatch<R2EventNotification>, env: Env): Promise<void> {
	const redis = Redis.fromEnv(env);
	const loggerLayer = makeLoggerLayer({ component: "R2Events", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");

	await Effect.runPromise(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.info("Processing R2 event batch", { messageCount: batch.messages.length });
		}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
	);

	for (const message of batch.messages) {
		const event = message.body;

		// Only process object creation events
		if (event.action !== "PutObject" && event.action !== "CompleteMultipartUpload") {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Skipping non-creation event", { action: event.action });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			message.ack();
			continue;
		}

		// Only process events from input bucket
		if (event.bucket !== env.R2_INPUT_BUCKET_NAME) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Skipping event from wrong bucket", { bucket: event.bucket, expectedBucket: env.R2_INPUT_BUCKET_NAME });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			message.ack();
			continue;
		}

		const objectKey = event.object.key;
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Processing upload event", { objectKey, size: event.object.size });
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		// Extract job ID from object key (format: inputs/{jobId}/filename)
		const jobId = extractJobIdFromKey(objectKey);
		if (!jobId) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.warn("Could not extract job ID from key", { objectKey });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			message.ack();
			continue;
		}

		try {
			// Get existing job data
			const jobData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));

			if (!jobData || Object.keys(jobData).length === 0) {
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job not found, creating new job", { jobId });
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				// Create a new job if it doesn't exist
				await createJobFromEvent(redis, env, jobId, event);
			} else {
				await Effect.runPromise(
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logger.info("Job exists, updating from event", { jobId });
					}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
				);
				// Update existing job
				await updateJobFromEvent(redis, env, jobId, jobData, event);
			}

			message.ack();
		} catch (error) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.error("Error processing job", error, { jobId });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			message.retry();
		}
	}
}

// Redis client type alias
type RedisClient = ReturnType<typeof Redis.fromEnv>;

/**
 * Create a new job from R2 event (for direct uploads without presigned URL)
 */
async function createJobFromEvent(redis: RedisClient, env: Env, jobId: string, event: R2EventNotification): Promise<void> {
	const loggerLayer = makeLoggerLayer({ component: "R2Events", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");
	const now = Date.now();

	const jobData: JobData = {
		jobId,
		status: "pending",
		inputKey: event.object.key,
		inputUrl: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${event.bucket}/${event.object.key}`,
		outputUrl: `outputs/${jobId}`,
		preset: "default",
		webhookUrl: `${env.WEBHOOK_BASE_URL}/webhooks/job-complete`,
		timestamps: {
			createdAt: now,
			uploadedAt: now,
			queuedAt: now,
		},
		retries: 0,
	};

	// Store job and enqueue
	const pipe = redis.pipeline();
	pipe.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
	pipe.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
	pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
	await pipe.exec();

	await Effect.runPromise(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.info("Created and enqueued job", { jobId, inputKey: event.object.key });
		}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
	);

	// Try to spawn a worker
	await trySpawnWorker(env);
}

/**
 * Update existing job from R2 event (for uploads via presigned URL)
 */
async function updateJobFromEvent(
	redis: RedisClient,
	env: Env,
	jobId: string,
	_existingData: Record<string, string>,
	event: R2EventNotification,
): Promise<void> {
	const loggerLayer = makeLoggerLayer({ component: "R2Events", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");
	const now = Date.now();

	// Update job status to pending (ready for processing)
	const updates: Record<string, string> = {
		status: "pending",
		inputUrl: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${event.bucket}/${event.object.key}`,
		uploadedAt: String(now),
		queuedAt: String(now),
	};

	// Store job and enqueue
	const pipe = redis.pipeline();
	pipe.hset(RedisKeys.jobStatus(jobId), updates);
	pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
	await pipe.exec();

	await Effect.runPromise(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.info("Updated and enqueued job", { jobId, inputKey: event.object.key });
		}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
	);

	// Try to spawn a worker
	await trySpawnWorker(env);
}

/**
 * Recovery environment interface (includes R2 bucket access)
 */
export interface RecoveryEnv extends Env {
	INPUT_BUCKET: R2Bucket;
}

/**
 * Recover a job stuck in "uploading" status.
 * Checks if file exists in R2 and transitions job to "pending" if found.
 */
export async function recoverUploadingJob(redis: RedisClient, env: RecoveryEnv, jobId: string, inputKey: string): Promise<boolean> {
	const loggerLayer = makeLoggerLayer({ component: "Recovery", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");
	try {
		// Check if file exists in R2
		const object = await env.INPUT_BUCKET.head(inputKey);
		if (!object) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("File not found in R2, cannot recover", { jobId, inputKey });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			return false;
		}

		const now = Date.now();

		// Get existing job data to preserve fields
		const existingData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
		if (!existingData || Object.keys(existingData).length === 0) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.warn("Job not found in Redis", { jobId });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			return false;
		}

		// Check if job is still in "uploading" status (avoid race conditions)
		if (existingData.status !== "uploading") {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Job already transitioned, skipping recovery", { jobId, currentStatus: existingData.status });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			return false;
		}

		// Build input URL
		const inputUrl = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_INPUT_BUCKET_NAME}/${inputKey}`;

		// Update job status to pending (ready for processing)
		const updates: Record<string, string> = {
			status: "pending",
			inputUrl,
			uploadedAt: String(now),
			queuedAt: String(now),
		};

		// Store job and enqueue atomically
		const pipe = redis.pipeline();
		pipe.hset(RedisKeys.jobStatus(jobId), updates);
		pipe.zadd(RedisKeys.jobsPending, { score: now, member: jobId });
		await pipe.exec();

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Recovered and enqueued job (file found in R2)", { jobId, inputKey });
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		// Try to spawn a worker
		await trySpawnWorker(env);

		return true;
	} catch (error) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.error("Error recovering job", error, { jobId, inputKey });
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
		return false;
	}
}

/**
 * Attempt to spawn a worker if capacity is available
 */
async function trySpawnWorker(env: Env): Promise<void> {
	const loggerLayer = makeLoggerLayer({ component: "R2Events", logLevel: "info" });
	const effectLoggerLayer = makeEffectLoggerLayer("info");
	try {
		const redisLayer = makeRedisLayer({
			UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
			UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Attempting to spawn worker", { appName: env.FLY_APP_NAME, region: env.FLY_REGION });
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		const spawnConfig: SpawnConfig = {
			flyApiToken: env.FLY_API_TOKEN,
			flyAppName: env.FLY_APP_NAME,
			flyRegion: env.FLY_REGION,
			redisUrl: env.UPSTASH_REDIS_REST_URL,
			redisToken: env.UPSTASH_REDIS_REST_TOKEN,
			webhookBaseUrl: env.WEBHOOK_BASE_URL,
		};

		const result = await Effect.runPromise(
			maybeSpawnWorker(spawnConfig).pipe(
				Effect.catchAll((err) =>
					Effect.gen(function* () {
						const logger = yield* LoggerService;
						if (err._tag === "CapacityFull") {
							yield* logger.warn("Spawn worker failed: capacity full", {
								reason: err.reason,
							});
						} else {
							yield* logger.error("Spawn worker failed", err, {
								errorType: err._tag,
							});
						}
						return null;
					}),
				),
				Effect.provide(redisLayer),
				Effect.provide(loggerLayer),
				Effect.provide(effectLoggerLayer),
			),
		);

		if (result) {
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Worker spawned successfully", { machineId: result.machineId, state: result.state });
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
		}
	} catch (error) {
		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.error("Failed to spawn worker", error);
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);
	}
}
