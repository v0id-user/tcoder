/**
 * Ephemeral FFmpeg Worker
 *
 * Runs as a one-shot batch job:
 * 1. Reads job parameters from environment variables
 * 2. Executes FFmpeg transcoding
 * 3. Exits (triggering machine stop and billing end)
 *
 * Machine lifecycle:
 * - Created via Fly Machines API
 * - Starts immediately
 * - Exits on completion/error
 * - Billing stops when process exits
 */

import { Effect, Console, Exit } from "effect";
import { $ } from "bun";

// Job configuration from environment
interface JobConfig {
	readonly jobId: string;
	readonly inputUrl: string;
	readonly outputUrl: string;
	readonly preset: string;
}

// Parse environment variables
const getJobConfig = Effect.sync((): JobConfig => {
	const jobId = process.env.JOB_ID;
	const inputUrl = process.env.INPUT_URL;
	const outputUrl = process.env.OUTPUT_URL;
	const preset = process.env.PRESET || "default";

	if (!jobId || !inputUrl || !outputUrl) {
		throw new Error(
			"Missing required env vars: JOB_ID, INPUT_URL, OUTPUT_URL"
		);
	}

	return { jobId, inputUrl, outputUrl, preset };
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
		default:
			return [...baseArgs, "-c", "copy", config.outputUrl];
	}
};

// Execute FFmpeg as Effect using Bun.$
const runFFmpeg = (config: JobConfig) =>
	Effect.gen(function* () {
		const args = getFFmpegArgs(config);

		yield* Console.log(`Starting FFmpeg: ffmpeg ${args.join(" ")}`);

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

// Main job program
const program = Effect.gen(function* () {
	yield* Console.log("🎬 FFmpeg Worker Starting");

	const config = yield* getJobConfig;
	yield* Console.log(`Job ID: ${config.jobId}`);
	yield* Console.log(`Input: ${config.inputUrl}`);
	yield* Console.log(`Output: ${config.outputUrl}`);
	yield* Console.log(`Preset: ${config.preset}`);

	const startTime = Date.now();

	yield* runFFmpeg(config);

	const duration = ((Date.now() - startTime) / 1000).toFixed(2);
	yield* Console.log(`✅ Job completed in ${duration}s`);
});

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

