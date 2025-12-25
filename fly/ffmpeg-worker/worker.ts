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
import { Console, Effect, Exit, Layer } from "effect";
import { LEASE_CONFIG, cleanupWorker, completeJob, failJob, getJobData, initializeWorker, popJob, updateMachineState } from "./lease";
import { R2ClientService, extractR2Key, getTempFilePath } from "./r2-client";
import { makeR2ClientLayer } from "./r2-client";
import { makeRedisLayer } from "./redis-client";
import { WebhookClientService, type WebhookPayload } from "./webhook-client";
import { makeWebhookClientLayer } from "./webhook-client";

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
		const r2Client = yield* R2ClientService;
		yield* Console.log(`[Download] ${inputUrl}`);
		yield* r2Client.download(inputUrl, localInputPath);
	});

const runFFmpeg = (args: string[]) =>
	Effect.gen(function* () {
		yield* Console.log("[FFmpeg] Starting transcoding...");
		yield* Effect.tryPromise({
			try: async () => {
				await $`ffmpeg ${args}`.quiet();
			},
			catch: (e) => new Error(`FFmpeg failed: ${e instanceof Error ? e.message : String(e)}`),
		});
	});

const uploadOutputs = (config: JobConfig, localOutputPaths: string[]) =>
	Effect.gen(function* () {
		const r2Client = yield* R2ClientService;
		const outputs: OutputFile[] = [];

		for (let i = 0; i < localOutputPaths.length; i++) {
			const localPath = localOutputPaths[i];
			const quality = config.outputQualities?.[i] || `quality-${i + 1}`;
			const baseR2Key = extractR2Key(config.outputUrl);
			const ext = localPath.match(/\.([^.]+)$/)?.[1] || "mp4";
			const r2Key = config.outputQualities ? `${baseR2Key.replace(/\.[^/.]+$/, "")}-${quality}.${ext}` : baseR2Key;

			yield* Console.log(`[Upload] ${quality} -> ${r2Key}`);
			const r2Url = yield* r2Client.upload(localPath, r2Key, {
				quality,
				preset: config.preset,
				jobId: config.jobId,
			});

			outputs.push({ quality, localPath, r2Key, r2Url });
		}

		return outputs;
	});

const notifyWebhook = (config: JobConfig, outputs: OutputFile[], duration: number, error?: string) =>
	Effect.gen(function* () {
		const webhookClient = yield* WebhookClientService;
		const payload: WebhookPayload = {
			jobId: config.jobId,
			status: error ? "failed" : "completed",
			inputUrl: config.inputUrl,
			outputs: outputs.map((o) => ({ quality: o.quality, url: o.r2Url, preset: config.preset })),
			error,
			duration: Math.round(duration),
		};
		yield* webhookClient.notify(payload);
	});

const cleanupFiles = (paths: string[]) =>
	Effect.gen(function* () {
		for (const path of paths) {
			yield* Effect.tryPromise({
				try: () => unlink(path),
				catch: () => null,
			});
		}
	});

/**
 * Process a single job.
 */
const processJob = (jobId: string) =>
	Effect.gen(function* () {
		yield* Console.log(`\n📦 Processing job: ${jobId}`);
		const startTime = Date.now();

		// Get job data from Redis
		const jobData = yield* getJobData(jobId);
		if (!jobData) {
			yield* Console.error(`Job ${jobId} not found in Redis`);
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

		const localInputPath = getTempFilePath(jobId, "input.mp4");
		const localOutputPaths = config.outputQualities
			? config.outputQualities.map((q) => getTempFilePath(jobId, `output-${q}.mp4`))
			: [getTempFilePath(jobId, "output.mp4")];

		let outputs: OutputFile[] = [];

		try {
			// Download
			yield* downloadInput(config.inputUrl, localInputPath);

			// Transcode
			const args = getFFmpegArgs(config, localInputPath, localOutputPaths[0]);
			yield* runFFmpeg(args);

			// Upload
			outputs = yield* uploadOutputs(config, localOutputPaths);

			const duration = (Date.now() - startTime) / 1000;
			yield* Console.log(`✅ Job ${jobId} completed in ${duration.toFixed(1)}s`);

			// Update Redis + webhook
			yield* completeJob(jobId, duration);
			yield* notifyWebhook(config, outputs, duration);
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			const duration = (Date.now() - startTime) / 1000;
			yield* Console.error(`❌ Job ${jobId} failed: ${error}`);

			yield* failJob(jobId, error);
			yield* notifyWebhook(config, outputs, duration, error);
		} finally {
			yield* cleanupFiles([localInputPath, ...localOutputPaths]);
		}
	});

// =============================================================================
// Multi-Job Worker Loop
// =============================================================================

const workerLoop = Effect.gen(function* () {
	const machineId = process.env.FLY_MACHINE_ID || `local-${Date.now()}`;
	yield* Console.log(`🎬 Worker ${machineId} starting (indefinite polling)`);

	// Initialize worker in pool
	const { startedAt } = yield* initializeWorker(machineId);
	let jobsProcessed = 0;

	try {
		// Poll indefinitely until stopped externally
		while (true) {
			// Pop job from queue
			const jobId = yield* popJob(machineId);

			if (!jobId) {
				// No jobs available, mark as idle and wait
				yield* updateMachineState(machineId, "idle");
				yield* Console.log(`[Worker] Queue empty, waiting ${LEASE_CONFIG.POLL_INTERVAL_MS / 1000}s...`);
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
	} catch (e) {
		yield* Console.error(`[Worker] Error in worker loop: ${e instanceof Error ? e.message : String(e)}`);
		throw e;
	} finally {
		// Cleanup on exit
		yield* cleanupWorker(machineId);
		yield* Console.log(`\n🏁 Worker exiting: ${jobsProcessed} jobs processed`);
	}
});

// =============================================================================
// Entry Point
// =============================================================================

const program = workerLoop.pipe(Effect.provide(Layer.mergeAll(makeRedisLayer, makeR2ClientLayer, makeWebhookClientLayer)));

Effect.runPromiseExit(program).then((exit) => {
	if (Exit.isSuccess(exit)) {
		console.log("Worker exiting successfully");
		process.exit(0);
	} else {
		console.error("Worker failed:", exit.cause);
		process.exit(1);
	}
});
