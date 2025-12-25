/**
 * R2 Event Notification Handler
 *
 * Processes R2 object-create events from the queue.
 * When a video is uploaded, enqueues a transcoding job.
 */

import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
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

	console.log(`[R2 Events] Processing ${batch.messages.length} events`);

	for (const message of batch.messages) {
		const event = message.body;

		// Only process object creation events
		if (event.action !== "PutObject" && event.action !== "CompleteMultipartUpload") {
			console.log(`[R2 Events] Skipping ${event.action} event`);
			message.ack();
			continue;
		}

		// Only process events from input bucket
		if (event.bucket !== env.R2_INPUT_BUCKET_NAME) {
			console.log(`[R2 Events] Skipping event from bucket: ${event.bucket}`);
			message.ack();
			continue;
		}

		const objectKey = event.object.key;
		console.log(`[R2 Events] Processing upload: ${objectKey}`);

		// Extract job ID from object key (format: inputs/{jobId}/filename)
		const jobId = extractJobIdFromKey(objectKey);
		if (!jobId) {
			console.log(`[R2 Events] Could not extract job ID from key: ${objectKey}`);
			message.ack();
			continue;
		}

		try {
			// Get existing job data
			const jobData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));

			if (!jobData || Object.keys(jobData).length === 0) {
				console.log(`[R2 Events] Job ${jobId} not found, creating new job`);
				// Create a new job if it doesn't exist
				await createJobFromEvent(redis, env, jobId, event);
			} else {
				// Update existing job
				await updateJobFromEvent(redis, env, jobId, jobData, event);
			}

			message.ack();
		} catch (error) {
			console.error(`[R2 Events] Error processing job ${jobId}:`, error);
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

	console.log(`[R2 Events] Created and enqueued job ${jobId}`);

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

	console.log(`[R2 Events] Updated and enqueued job ${jobId}`);

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
export async function recoverUploadingJob(
	redis: RedisClient,
	env: RecoveryEnv,
	jobId: string,
	inputKey: string,
): Promise<boolean> {
	try {
		// Check if file exists in R2
		const object = await env.INPUT_BUCKET.head(inputKey);
		if (!object) {
			// File doesn't exist yet
			return false;
		}

		const now = Date.now();

		// Get existing job data to preserve fields
		const existingData = await redis.hgetall<Record<string, string>>(RedisKeys.jobStatus(jobId));
		if (!existingData || Object.keys(existingData).length === 0) {
			console.log(`[Recovery] Job ${jobId} not found in Redis`);
			return false;
		}

		// Check if job is still in "uploading" status (avoid race conditions)
		if (existingData.status !== "uploading") {
			console.log(`[Recovery] Job ${jobId} already transitioned to ${existingData.status}`);
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

		console.log(`[Recovery] Recovered and enqueued job ${jobId} (file found in R2)`);

		// Try to spawn a worker
		await trySpawnWorker(env);

		return true;
	} catch (error) {
		console.error(`[Recovery] Error recovering job ${jobId}:`, error);
		return false;
	}
}

/**
 * Attempt to spawn a worker if capacity is available
 */
async function trySpawnWorker(env: Env): Promise<void> {
	try {
		const redisLayer = makeRedisLayer({
			UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
			UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
		});

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
				Effect.catchAll(() => Effect.succeed(null)),
				Effect.provide(redisLayer),
			),
		);

		if (result) {
			console.log(`[R2 Events] Spawned worker: ${result.machineId}`);
		}
	} catch (error) {
		console.error("[R2 Events] Failed to spawn worker:", error);
	}
}
