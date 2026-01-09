/**
 * Multi-Job FFmpeg Worker with Redis Orchestration
 *
 * Runs as a TTL-bounded worker that processes multiple jobs:
 * 1. Verifies and activates lease from Redis (registered by spawner)
 * 2. Polls job queue for work
 * 3. Processes jobs until TTL or max jobs reached
 * 4. Releases lease and exits gracefully
 *
 * Worker lifecycle:
 * - Created via Fly Machines API (spawner registers lease with status "starting")
 * - Verifies Redis lease exists and activates it
 * - Processes 1-3 jobs (configurable)
 * - Exits after TTL (5 min) or max jobs
 * - Billing stops when process exits
 */

import { unlink } from "node:fs/promises";
import { $ } from "bun";
import { Effect, Exit, Layer } from "effect";
import {
	type LogLevel,
	LoggerService,
	logJobCompleted,
	logJobFailed,
	logJobStarted,
	logWorkerStarted,
	logWorkerStopped,
	makeEffectLoggerLayer,
	makeLoggerLayer,
} from "../../packages/logger";
import {
	LEASE_CONFIG,
	cleanupWorker,
	completeJob,
	handleJobFailure,
	getJobData,
	initializeWorker,
	popJob,
	updateMachineState,
} from "./lease";
import { R2ClientService, extractR2Key, getTempFilePath } from "./r2-client";
import { makeR2ClientLayer } from "./r2-client";
import { makeRedisLayer } from "./redis-client";
import { WebhookClientService, type WebhookPayload } from "./webhook-client";
import { makeWebhookClientLayer } from "./webhook-client";

// =============================================================================
// Environment Validation
// =============================================================================

interface EnvValidationResult {
	readonly isValid: boolean;
	readonly missing: string[];
	readonly warnings: string[];
}

/**
 * Validate all required environment variables at startup.
 * Exits immediately with clear error message if any required var is missing.
 */
function validateEnvironment(): EnvValidationResult {
	const required = [
		"UPSTASH_REDIS_REST_URL",
		"UPSTASH_REDIS_REST_TOKEN",
		"R2_ACCOUNT_ID",
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"R2_INPUT_BUCKET_NAME",
		"R2_OUTPUT_BUCKET_NAME",
	];

	const missing: string[] = [];
	const warnings: string[] = [];

	for (const envVar of required) {
		if (!process.env[envVar]) {
			missing.push(envVar);
		}
	}

	// Check optional vars and warn if missing
	if (!process.env.WEBHOOK_URL) {
		warnings.push("WEBHOOK_URL not set - job completion webhooks will be skipped");
	}

	return {
		isValid: missing.length === 0,
		missing,
		warnings,
	};
}

// =============================================================================
// Active Job Tracking (for crash recovery)
// =============================================================================

/**
 * Tracks the currently processing job ID.
 * Used by crash handlers to mark the job as failed if the worker crashes.
 */
let activeJobId: string | null = null;

/**
 * Set the active job ID being processed.
 */
function setActiveJob(jobId: string | null): void {
	activeJobId = jobId;
}

/**
 * Get the currently active job ID.
 */
function getActiveJob(): string | null {
	return activeJobId;
}

// =============================================================================
// Types
// =============================================================================

interface JobConfig {
	readonly jobId: string;
	readonly inputUrl: string;
	readonly outputUrl: string;
	readonly preset: string;
	readonly webhookUrl: string;
	readonly outputQualities?: string[];
}

interface OutputFile {
	readonly quality: string;
	readonly localPath: string;
	readonly r2Key: string;
	readonly r2Url: string;
}

// =============================================================================
// FFmpeg Presets
// =============================================================================

const getFFmpegArgs = (config: JobConfig, localInputPath: string, localOutputPath: string): string[] => {
	const baseArgs = ["-i", localInputPath, "-y"];

	switch (config.preset) {
		case "web-optimized":
			return [...baseArgs, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", localOutputPath];
		case "hls":
			return [
				...baseArgs,
				"-c:v",
				"libx264",
				"-preset",
				"fast",
				"-g",
				"48",
				"-sc_threshold",
				"0",
				"-c:a",
				"aac",
				"-hls_time",
				"4",
				"-hls_playlist_type",
				"vod",
				localOutputPath,
			];
		default:
			return [...baseArgs, "-c", "copy", localOutputPath];
	}
};

// =============================================================================
// Job Processing
// =============================================================================

const downloadInput = (inputUrl: string, localInputPath: string) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const r2Client = yield* R2ClientService;
		const startTime = Date.now();
		yield* logger.debug("[downloadInput] Entering", { inputUrl, localInputPath });
		yield* logger.debug("Downloading input", { inputUrl, localInputPath });
		yield* r2Client.download(inputUrl, localInputPath);
		const duration = Date.now() - startTime;
		yield* logger.debug("[downloadInput] Exiting", { inputUrl, localInputPath, duration: `${duration}ms` });
	});

const runFFmpeg = (args: string[]) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const startTime = Date.now();
		yield* logger.debug("[runFFmpeg] Entering", { args: args.join(" ") });
		yield* logger.info("Starting FFmpeg transcoding", { args: args.join(" ") });
		yield* Effect.tryPromise({
			try: async () => {
				await $`ffmpeg ${args}`.quiet();
			},
			catch: (e) => new Error(`FFmpeg failed: ${e instanceof Error ? e.message : String(e)}`),
		});
		const duration = Date.now() - startTime;
		yield* logger.debug("FFmpeg transcoding completed");
		yield* logger.debug("[runFFmpeg] Exiting", { duration: `${duration}ms` });
	});

/**
 * Generate a descriptive quality name based on context.
 * Uses provided outputQualities when available, otherwise derives from preset and index.
 */
const getQualityName = (config: JobConfig, index: number, totalOutputs: number): string => {
	// If quality is explicitly provided, use it (e.g., "720p", "1080p", "web")
	if (config.outputQualities?.[index]) {
		return config.outputQualities[index];
	}

	// For single output without explicit quality, use preset name
	if (totalOutputs === 1) {
		return config.preset;
	}

	// For multiple outputs without explicit qualities, combine preset with index
	return `${config.preset}-${index + 1}`;
};

const uploadOutputs = (config: JobConfig, localOutputPaths: string[]) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const r2Client = yield* R2ClientService;
		const startTime = Date.now();
		yield* logger.debug("[uploadOutputs] Entering", {
			jobId: config.jobId,
			outputCount: localOutputPaths.length,
			outputPaths: localOutputPaths,
		});
		const outputs: OutputFile[] = [];

		for (let i = 0; i < localOutputPaths.length; i++) {
			const localPath = localOutputPaths[i];
			const quality = getQualityName(config, i, localOutputPaths.length);
			const baseR2Key = extractR2Key(config.outputUrl);
			const ext = localPath.match(/\.([^.]+)$/)?.[1] || "mp4";
			const r2Key = config.outputQualities ? `${baseR2Key.replace(/\.[^/.]+$/, "")}-${quality}.${ext}` : baseR2Key;

			yield* logger.debug("Uploading output", { quality, r2Key, localPath });
			const r2Url = yield* r2Client.upload(localPath, r2Key, {
				quality,
				preset: config.preset,
				jobId: config.jobId,
			});

			outputs.push({ quality, localPath, r2Key, r2Url });
		}

		const duration = Date.now() - startTime;
		yield* logger.debug("[uploadOutputs] Exiting", {
			jobId: config.jobId,
			outputCount: outputs.length,
			duration: `${duration}ms`,
		});
		return outputs;
	});

const notifyWebhook = (config: JobConfig, outputs: OutputFile[], duration: number, error?: string) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const webhookClient = yield* WebhookClientService;
		const startTime = Date.now();
		yield* logger.debug("[notifyWebhook] Entering", {
			jobId: config.jobId,
			webhookUrl: config.webhookUrl,
			status: error ? "failed" : "completed",
			outputCount: outputs.length,
		});
		const payload: WebhookPayload = {
			jobId: config.jobId,
			status: error ? "failed" : "completed",
			inputUrl: config.inputUrl,
			outputs: outputs.map((o) => ({ quality: o.quality, url: o.r2Url, preset: config.preset })),
			error,
			duration: Math.round(duration),
		};
		// Webhook notification is optional - errors are logged but don't fail the job
		yield* webhookClient.notify(payload);
		const notifyDuration = Date.now() - startTime;
		yield* logger.debug("[notifyWebhook] Exiting", {
			jobId: config.jobId,
			duration: `${notifyDuration}ms`,
		});
	});

const cleanupFiles = (paths: string[]) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const startTime = Date.now();
		yield* logger.debug("[cleanupFiles] Entering", { fileCount: paths.length, paths });
		for (const path of paths) {
			yield* Effect.tryPromise({
				try: () => unlink(path),
				catch: () => null,
			});
		}
		const duration = Date.now() - startTime;
		yield* logger.debug("[cleanupFiles] Exiting", { fileCount: paths.length, duration: `${duration}ms` });
	});

/**
 * Process a single job.
 */
const processJob = (jobId: string) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const startTime = Date.now();
		yield* logger.debug("[processJob] Entering", { jobId });

		// Track active job for crash recovery
		setActiveJob(jobId);

		// Get job data from Redis
		const jobData = yield* getJobData(jobId);
		if (!jobData) {
			yield* logger.error("Job not found in Redis", undefined, { jobId });
			yield* logger.debug("[processJob] Exiting early - job not found", { jobId });
			return;
		}

		const config: JobConfig = {
			jobId,
			inputUrl: jobData.inputUrl || "",
			outputUrl: jobData.outputUrl || "",
			preset: jobData.preset || "default",
			webhookUrl: jobData.webhookUrl || "",
			outputQualities: jobData.outputQualities?.split(","),
		};

		// Create scoped logger with jobId context
		const jobLogger = logger.withContext({ jobId }) as unknown as typeof logger;

		yield* logJobStarted(jobLogger, config.jobId, config.inputUrl, config.preset);

		const localInputPath = getTempFilePath(jobId, "input.mp4");
		const localOutputPaths = config.outputQualities
			? config.outputQualities.map((q) => getTempFilePath(jobId, `output-${q}.mp4`))
			: [getTempFilePath(jobId, "output.mp4")];

		const machineId = process.env.FLY_MACHINE_ID || `local-${Date.now()}`;

		const result = yield* Effect.gen(function* () {
			// Download
			yield* downloadInput(config.inputUrl, localInputPath);

			// Transcode
			const args = getFFmpegArgs(config, localInputPath, localOutputPaths[0]);
			yield* runFFmpeg(args);

			// Upload
			const outputs = yield* uploadOutputs(config, localOutputPaths);

			return outputs;
		}).pipe(
			// Use matchEffect to properly execute the returned Effects
			Effect.matchEffect({
				onFailure: (error) => {
					const errorMessage = error instanceof Error ? error.message : String(error);
					const duration = (Date.now() - startTime) / 1000;
					return Effect.gen(function* () {
						yield* logJobFailed(jobLogger, config.jobId, errorMessage, duration);
						// Use shared failure handler which handles retries and worker failure tracking
						yield* handleJobFailure(jobId, machineId, errorMessage);
						yield* notifyWebhook(config, [], duration, errorMessage);
						return null; // Return null to indicate failure was handled
					});
				},
				onSuccess: (outputs) => {
					const duration = (Date.now() - startTime) / 1000;
					const jobOutputs = outputs.map((o) => ({ quality: o.quality, url: o.r2Url }));
					return Effect.gen(function* () {
						yield* logJobCompleted(jobLogger, config.jobId, duration, jobOutputs);
						// Save outputs directly to Redis for reliability (webhook is a backup)
						yield* completeJob(jobId, duration, jobOutputs);
						yield* notifyWebhook(config, outputs, duration);
						return outputs; // Return outputs to indicate success
					});
				},
			}),
		);

		// Cleanup files
		yield* cleanupFiles([localInputPath, ...localOutputPaths]);

		// Clear active job tracking (job completed successfully or failed gracefully)
		setActiveJob(null);

		const totalDuration = Date.now() - startTime;
		yield* logger.debug("[processJob] Exiting", {
			jobId,
			totalDuration: `${totalDuration}ms`,
			success: result !== undefined,
		});
		return result;
	});

// =============================================================================
// Multi-Job Worker Loop
// =============================================================================

const workerLoop = Effect.gen(function* () {
	const logger = yield* LoggerService;
	const machineId = process.env.FLY_MACHINE_ID || `local-${Date.now()}`;
	const loopStartTime = Date.now();

	yield* logger.debug("[workerLoop] Entering", { machineId });
	yield* logWorkerStarted(logger, machineId);

	// Initialize worker in pool
	const { startedAt } = yield* initializeWorker(machineId);
	let jobsProcessed = 0;

	const loop = Effect.gen(function* () {
		// Poll indefinitely until stopped externally
		while (true) {
			// Pop job from queue
			const jobId = yield* popJob(machineId);

			if (!jobId) {
				// No jobs available, mark as idle and wait
				yield* updateMachineState(machineId, "idle");
				yield* logger.debug("Queue empty, waiting", {
					pollInterval: LEASE_CONFIG.POLL_INTERVAL_MS / 1000,
				});
				yield* Effect.sleep(`${LEASE_CONFIG.POLL_INTERVAL_MS} millis`);
				continue;
			}

			// Job found, mark as running
			yield* updateMachineState(machineId, "running");

			// Process job
			yield* processJob(jobId);
			jobsProcessed++;

			// Update state after job (will be set to idle on next iteration if no job)
		}
	});

	yield* loop.pipe(
		Effect.catchAll((error) => {
			return Effect.gen(function* () {
				yield* logger.error("Error in worker loop", error, {
					machineId,
					jobsProcessed,
				});
				return yield* Effect.fail(error);
			});
		}),
		Effect.ensuring(
			Effect.gen(function* () {
				// Cleanup on exit
				const loopDuration = Date.now() - loopStartTime;
				const workerUptime = Date.now() - startedAt;
				yield* logger.debug("[workerLoop] Exiting", {
					machineId,
					jobsProcessed,
					loopDuration: `${loopDuration}ms`,
					workerUptime: `${workerUptime}ms`,
					startedAt,
				});
				yield* cleanupWorker(machineId).pipe(Effect.catchAll(() => Effect.void));
				yield* logWorkerStopped(logger, machineId, jobsProcessed);
			}),
		),
	);
});

// =============================================================================
// Entry Point
// =============================================================================

// Validate environment before starting
const envValidation = validateEnvironment();
if (!envValidation.isValid) {
	console.error("============================================================");
	console.error("[FFmpeg Worker] FATAL: Missing required environment variables");
	console.error("============================================================");
	console.error("Missing:", envValidation.missing.join(", "));
	console.error("");
	console.error("The worker cannot start without these variables.");
	console.error("Ensure they are set in:");
	console.error("  - .env file (for docker-compose)");
	console.error("  - Environment variables in docker-compose.yml");
	console.error("  - Fly.io secrets (for production)");
	console.error("============================================================");
	process.exit(1);
}

// Log warnings for optional vars
for (const warning of envValidation.warnings) {
	console.warn(`[FFmpeg Worker] Warning: ${warning}`);
}

const machineId = process.env.FLY_MACHINE_ID || `local-${Date.now()}`;
const logLevel = (process.env.LOG_LEVEL || (machineId.startsWith("local-") ? "debug" : "info")) as LogLevel;
const loggerLayer = makeLoggerLayer({
	component: "ffmpeg-worker",
	machineId,
	logLevel,
});
const effectLoggerLayer = makeEffectLoggerLayer(logLevel);

// =============================================================================
// Crash Recovery Handlers
// =============================================================================

/**
 * Mark active job as failed on crash.
 * Uses direct Redis call outside Effect runtime since we're in error handler.
 */
async function markActiveJobFailed(reason: string): Promise<void> {
	const jobId = getActiveJob();
	if (!jobId) {
		return; // No active job to mark as failed
	}

	const machineId = process.env.FLY_MACHINE_ID || `local-${Date.now()}`;
	console.error(`[Crash Recovery] Marking job ${jobId} as failed: ${reason}`);

	try {
		// Create a minimal Redis program to handle job failure (includes retry logic and worker tracking)
		const markFailedProgram = handleJobFailure(jobId, machineId, `Worker crashed: ${reason}`).pipe(
			Effect.provide(Layer.mergeAll(loggerLayer, effectLoggerLayer, makeRedisLayer)),
		);
		await Effect.runPromise(markFailedProgram);
		console.error(`[Crash Recovery] Successfully handled job ${jobId} failure`);
	} catch (error) {
		console.error(`[Crash Recovery] Failed to handle job ${jobId} failure:`, error);
	}
}

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
	console.error("[FFmpeg Worker] Uncaught exception:", error);
	await markActiveJobFailed(`Uncaught exception: ${error.message}`);
	process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", async (reason) => {
	console.error("[FFmpeg Worker] Unhandled rejection:", reason);
	const message = reason instanceof Error ? reason.message : String(reason);
	await markActiveJobFailed(`Unhandled rejection: ${message}`);
	process.exit(1);
});

// Handle SIGTERM (graceful shutdown)
process.on("SIGTERM", async () => {
	console.log("[FFmpeg Worker] Received SIGTERM, shutting down gracefully...");
	await markActiveJobFailed("Worker received SIGTERM");
	process.exit(0);
});

// Handle SIGINT (Ctrl+C)
process.on("SIGINT", async () => {
	console.log("[FFmpeg Worker] Received SIGINT, shutting down...");
	await markActiveJobFailed("Worker received SIGINT");
	process.exit(0);
});

// =============================================================================
// Run Worker
// =============================================================================

const program = workerLoop.pipe(
	Effect.provide(Layer.mergeAll(loggerLayer, effectLoggerLayer, makeRedisLayer, makeR2ClientLayer, makeWebhookClientLayer)),
);

Effect.runPromiseExit(program).then((exit) => {
	if (Exit.isSuccess(exit)) {
		process.exit(0);
	} else {
		// Use console.error here as this is the runtime boundary
		console.error("Worker failed:", exit.cause);
		// The crash handlers above will have already marked any active job as failed
		process.exit(1);
	}
});
