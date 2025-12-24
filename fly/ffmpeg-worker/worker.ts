/**
 * Ephemeral FFmpeg Worker
 *
 * Runs as a one-shot batch job:
 * 1. Reads job parameters from environment variables
 * 2. Downloads input video from R2 storage
 * 3. Executes FFmpeg transcoding
 * 4. Uploads transcoded outputs to R2 storage
 * 5. Sends webhook notification to Worker API
 * 6. Cleans up temporary files
 * 7. Exits (triggering machine stop and billing end)
 *
 * Machine lifecycle:
 * - Created via Fly Machines API
 * - Starts immediately
 * - Exits on completion/error
 * - Billing stops when process exits
 */

import { Effect, Console, Exit, Layer, pipe } from "effect";
import { $ } from "bun";
import { unlink } from "node:fs/promises";
import { R2ClientService, getTempFilePath, extractR2Key } from "./r2-client";
import {
	WebhookClientService,
	type WebhookPayload,
} from "./webhook-client";
import { makeR2ClientLayer } from "./r2-client";
import { makeWebhookClientLayer } from "./webhook-client";

// Job configuration from environment
interface JobConfig {
	readonly jobId: string;
	readonly inputUrl: string; // R2 presigned URL or direct URL
	readonly outputUrl: string; // Base output URL (may generate multiple qualities)
	readonly preset: string;
	readonly webhookUrl: string; // Required webhook URL for completion notification (Phase 4 - Discoverability Phase)
	readonly outputQualities?: string[]; // Optional: ["480p", "720p", "1080p"]
}

// Output file tracking
interface OutputFile {
	readonly quality: string;
	readonly localPath: string;
	readonly r2Key: string;
	readonly r2Url: string;
}

// Parse environment variables
const getJobConfig = Effect.sync((): JobConfig => {
	const jobId = process.env.JOB_ID;
	const inputUrl = process.env.INPUT_URL;
	const outputUrl = process.env.OUTPUT_URL;
	const preset = process.env.PRESET || "default";
	const webhookUrl = process.env.WEBHOOK_URL;
	const outputQualities = process.env.OUTPUT_QUALITIES
		? process.env.OUTPUT_QUALITIES.split(",").map((q) => q.trim())
		: undefined;

	if (!jobId || !inputUrl || !outputUrl || !webhookUrl) {
		throw new Error(
			"Missing required env vars: JOB_ID, INPUT_URL, OUTPUT_URL, WEBHOOK_URL"
		);
	}

	return {
		jobId,
		inputUrl,
		outputUrl,
		preset,
		webhookUrl,
		outputQualities,
	};
});

// FFmpeg transcoding presets
const getFFmpegArgs = (config: JobConfig): string[] => {
	const baseArgs = [
		"-i",
		config.inputUrl,
		"-y", // Overwrite output
	];

	switch (config.preset) {
		case "web-optimized":
			return [
				...baseArgs,
				"-c:v",
				"libx264",
				"-preset",
				"fast",
				"-crf",
				"23",
				"-c:a",
				"aac",
				"-b:a",
				"128k",
				config.outputUrl,
			];
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
				config.outputUrl,
			];
		case "hls-adaptive": {
			// Extract base path from output URL for variant naming
			// FFmpeg will generate: variant_0.m3u8, variant_1.m3u8, variant_2.m3u8
			// and master playlist at the specified OUTPUT_URL
			const outputBase = config.outputUrl.includes(".m3u8")
				? config.outputUrl.replace(/\/[^/]*\.m3u8?$/, "")
				: config.outputUrl.replace(/\/[^/]*$/, "");
			const masterName = config.outputUrl.includes(".m3u8")
				? config.outputUrl.split("/").pop() || "master.m3u8"
				: "master.m3u8";

			// Build output pattern: variants will be variant_0.m3u8, variant_1.m3u8, variant_2.m3u8
			const variantPattern = `${outputBase}/variant_%v.m3u8`;

			return [
				...baseArgs,
				// Filter complex: split input video into 3 streams and scale each
				"-filter_complex",
				"[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080[v1080];[v2]scale=854:480[v480];[v3]scale=256:144[v144]",
				// Map 1080p variant (will be variant 0)
				"-map",
				"[v1080]",
				"-c:v:0",
				"libx264",
				"-preset:0",
				"fast",
				"-crf:0",
				"23",
				"-b:v:0",
				"5M",
				"-maxrate:0",
				"5M",
				"-bufsize:0",
				"10M",
				"-map",
				"0:a",
				"-c:a:0",
				"aac",
				"-b:a:0",
				"192k",
				// Map 480p variant (will be variant 1)
				"-map",
				"[v480]",
				"-c:v:1",
				"libx264",
				"-preset:1",
				"fast",
				"-crf:1",
				"23",
				"-b:v:1",
				"2M",
				"-maxrate:1",
				"2M",
				"-bufsize:1",
				"4M",
				"-map",
				"0:a",
				"-c:a:1",
				"aac",
				"-b:a:1",
				"128k",
				// Map 144p variant (will be variant 2)
				"-map",
				"[v144]",
				"-c:v:2",
				"libx264",
				"-preset:2",
				"fast",
				"-crf:2",
				"23",
				"-b:v:2",
				"500k",
				"-maxrate:2",
				"500k",
				"-bufsize:2",
				"1M",
				"-map",
				"0:a",
				"-c:a:2",
				"aac",
				"-b:a:2",
				"64k",
				// Global HLS and encoding settings
				"-g",
				"48",
				"-sc_threshold",
				"0",
				"-hls_time",
				"4",
				"-hls_playlist_type",
				"vod",
				"-hls_segment_filename",
				`${outputBase}/variant_%v_%03d.ts`,
				"-master_pl_name",
				masterName,
				"-var_stream_map",
				"v:0,a:0 v:1,a:1 v:2,a:2",
				"-f",
				"hls",
				variantPattern,
			];
		}
		default:
			return [...baseArgs, "-c", "copy", config.outputUrl];
	}
};

// Download input video from R2
const downloadInput = (config: JobConfig, localInputPath: string) =>
	Effect.gen(function* () {
		const r2Client = yield* R2ClientService;
		yield* Console.log(`[Download] Starting download from ${config.inputUrl}`);
		yield* r2Client.download(config.inputUrl, localInputPath);
		yield* Console.log(`[Download] Completed: ${localInputPath}`);
	});

// Execute FFmpeg as Effect using Bun.$
// Returns list of output files that were generated
const runFFmpeg = (
	config: JobConfig,
	localInputPath: string,
	localOutputPaths: string[]
) =>
	Effect.gen(function* () {
		// Update FFmpeg args to use local input path
		const args = getFFmpegArgs({
			...config,
			inputUrl: localInputPath,
			outputUrl: localOutputPaths[0] || config.outputUrl,
		});

		// For multiple outputs, we may need to run FFmpeg multiple times
		// or use a single command that generates multiple files
		// For now, handle single output case
		if (localOutputPaths.length > 1) {
			// TODO: Implement multi-output FFmpeg execution
			yield* Console.log(
				`[FFmpeg] Multiple outputs not yet fully implemented, using first output`
			);
		}

		yield* Console.log(`[FFmpeg] Starting: ffmpeg ${args.join(" ")}`);

		// Use Bun.$ for process execution
		const result = yield* Effect.tryPromise({
			try: async () => {
				const proc = await $`ffmpeg ${args}`.quiet();
				return proc;
			},
			catch: (error) => {
				if (error instanceof Error) {
					return error;
				}
				return new Error(`FFmpeg failed: ${String(error)}`);
			},
		});

		return result;
	});

// Upload outputs to R2
const uploadOutputs = (
	config: JobConfig,
	localOutputPaths: string[]
) =>
	Effect.gen(function* () {
		const r2Client = yield* R2ClientService;
		const outputs: OutputFile[] = [];

		for (let i = 0; i < localOutputPaths.length; i++) {
			const localPath = localOutputPaths[i];
			const quality =
				config.outputQualities?.[i] || `quality-${i + 1}`;
			const baseR2Key = extractR2Key(config.outputUrl);
			const r2Key = config.outputQualities
				? `${baseR2Key.replace(/\.[^/.]+$/, "")}-${quality}${getFileExtension(localPath)}`
				: baseR2Key;

			yield* Console.log(
				`[Upload] Uploading ${quality} to R2 key: ${r2Key}`
			);

			const r2Url = yield* r2Client.upload(localPath, r2Key, {
				quality,
				preset: config.preset,
				jobId: config.jobId,
			});

			outputs.push({
				quality,
				localPath,
				r2Key,
				r2Url,
			});
		}

		return outputs;
	});

// Helper: Get file extension
const getFileExtension = (path: string): string => {
	const match = path.match(/\.([^.]+)$/);
	return match ? `.${match[1]}` : "";
};

// Send webhook notification (Phase 4 - Discoverability Phase)
const notifyWebhook = (
	config: JobConfig,
	outputs: OutputFile[],
	duration: number,
	error?: string
) =>
	Effect.gen(function* () {
		const webhookClient = yield* WebhookClientService;

		const payload: WebhookPayload = {
			jobId: config.jobId,
			status: error ? "failed" : "completed",
			inputUrl: config.inputUrl,
			outputs: outputs.map((out) => ({
				quality: out.quality,
				url: out.r2Url,
				preset: config.preset,
			})),
			error,
			duration: Math.round(duration),
		};

		yield* webhookClient.notify(payload);
	});

// Cleanup temporary files
const cleanupFiles = (paths: string[]) =>
	Effect.gen(function* () {
		for (const path of paths) {
			yield* Effect.tryPromise({
				try: () => unlink(path),
				catch: (error) => {
					// Log but don't fail on cleanup errors
					console.warn(`Failed to cleanup ${path}:`, error);
					return null;
				},
			});
		}
		yield* Console.log(`[Cleanup] Removed ${paths.length} temporary file(s)`);
	});

// Main job program
const program = Effect.gen(function* () {
	yield* Console.log("🎬 FFmpeg Worker Starting");

	const config = yield* getJobConfig;
	yield* Console.log(`Job ID: ${config.jobId}`);
	yield* Console.log(`Input: ${config.inputUrl}`);
	yield* Console.log(`Output: ${config.outputUrl}`);
	yield* Console.log(`Preset: ${config.preset}`);
	yield* Console.log(`Webhook: ${config.webhookUrl}`);
	if (config.outputQualities) {
		yield* Console.log(`Qualities: ${config.outputQualities.join(", ")}`);
	}

	const startTime = Date.now();
	const localInputPath = getTempFilePath(config.jobId, "input.mp4");
	const localOutputPaths = config.outputQualities
		? config.outputQualities.map((q) =>
				getTempFilePath(config.jobId, `output-${q}.mp4`)
			)
		: [getTempFilePath(config.jobId, "output.mp4")];

	let outputs: OutputFile[] = [];
	let error: string | undefined;

	try {
		// Phase 1: Download input from R2
		yield* downloadInput(config, localInputPath);

		// Phase 2: Run FFmpeg transcoding
		yield* runFFmpeg(config, localInputPath, localOutputPaths);

		// Phase 3: Upload outputs to R2
		outputs = yield* uploadOutputs(config, localOutputPaths);

		const duration = (Date.now() - startTime) / 1000;
		yield* Console.log(`✅ Transcoding completed in ${duration.toFixed(2)}s`);

		// Phase 4: Send webhook notification
		yield* notifyWebhook(config, outputs, duration);
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
		const duration = (Date.now() - startTime) / 1000;
		yield* Console.error(`❌ Job failed: ${error}`);
		yield* notifyWebhook(config, outputs, duration, error);
		throw e;
	} finally {
		// Phase 5: Cleanup temporary files
		const allPaths = [localInputPath, ...localOutputPaths];
		yield* cleanupFiles(allPaths);
	}
}).pipe(
	Effect.provide(
		Layer.merge(makeR2ClientLayer, makeWebhookClientLayer)
	)
);

// Run and exit
Effect.runPromiseExit(program).then((exit) => {
	if (Exit.isSuccess(exit)) {
		console.log("Worker exiting successfully");
		process.exit(0);
	} else {
		console.error("Worker failed:", exit.cause);
		process.exit(1);
	}
});

