/**
 * TcoderClient - Video Transcoding SDK
 *
 * Simple SDK for uploading videos and checking transcoding job status.
 * Automates the workflow: request presigned URL → upload to R2 → track job status.
 */

import { Effect } from "effect";
import { createClient, type Client } from "./client";

// =============================================================================
// Types
// =============================================================================

export interface UploadOptions {
	/** Original filename */
	filename: string;
	/** MIME type (e.g., "video/mp4") */
	contentType?: string;
	/** Transcoding preset */
	preset?: "default" | "web-optimized" | "hls" | "hls-adaptive";
	/** Output quality levels (e.g., ["480p", "720p", "1080p"]) */
	outputQualities?: string[];
}

export interface UploadResponse {
	/** Job ID for tracking */
	jobId: string;
	/** Current job status */
	status: "uploading";
}

export interface JobOutput {
	/** Quality level (e.g., "480p", "720p") */
	quality: string;
	/** URL to the transcoded video */
	url: string;
}

export interface JobStatus {
	/** Job ID */
	jobId: string;
	/** Current status */
	status: "uploading" | "queued" | "pending" | "running" | "completed" | "failed";
	/** Machine ID processing the job (if running) */
	machineId?: string | null;
	/** Transcoding outputs (available when completed) */
	outputs?: JobOutput[];
	/** Error message (if failed) */
	error?: string;
	/** Job timestamps */
	timestamps: {
		createdAt: number;
		uploadedAt?: number;
		queuedAt?: number;
		startedAt?: number;
		completedAt?: number;
	};
	/** Original filename */
	filename?: string;
	/** Transcoding preset used */
	preset?: string;
}

export interface ClientConfig {
	/** Base URL of the API server */
	baseUrl: string;
	/** Optional client configuration (headers, credentials, etc.) */
	options?: Parameters<typeof import("./client").createClient>[1];
}

// =============================================================================
// Errors
// =============================================================================

export class UploadError extends Error {
	readonly _tag = "UploadError";
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "UploadError";
		this.cause = cause;
	}
}

export class StatusError extends Error {
	readonly _tag = "StatusError";
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "StatusError";
		this.cause = cause;
	}
}

// =============================================================================
// TcoderClient Class
// =============================================================================

/**
 * Main SDK class for video transcoding operations.
 */
export class TcoderClient {
	private readonly client: Client;

	/**
	 * Create a new TcoderClient instance.
	 *
	 * @param config - Client configuration
	 *
	 * @example
	 * ```ts
	 * const client = new TcoderClient({ baseUrl: "http://localhost:8787" });
	 * ```
	 */
	constructor(config: ClientConfig | string) {
		const baseUrl = typeof config === "string" ? config : config.baseUrl;
		const options = typeof config === "string" ? undefined : config.options;
		this.client = createClient(baseUrl, options);
	}

	/**
	 * Upload a video file and start a transcoding job.
	 *
	 * This method:
	 * 1. Requests a presigned upload URL from the API
	 * 2. Uploads the file directly to R2 storage
	 * 3. Returns the job ID for status tracking
	 *
	 * @param blob - Video file as Blob (works in browser and Node.js)
	 * @param options - Upload configuration
	 * @returns Effect that resolves to upload response with jobId
	 *
	 * @example
	 * ```ts
	 * const result = await Effect.runPromise(
	 *   client.upload(videoBlob, {
	 *     filename: "video.mp4",
	 *     contentType: "video/mp4",
	 *     preset: "default"
	 *   })
	 * );
	 * console.log(result.jobId);
	 * ```
	 */
	upload(blob: Blob, options: UploadOptions): Effect.Effect<UploadResponse, UploadError> {
		const client = this.client;
		return Effect.gen(function* () {
			// Step 1: Request presigned upload URL
			const uploadRequest = yield* Effect.tryPromise({
				try: () =>
					client.api.upload.$post({
						json: {
							filename: options.filename,
							contentType: options.contentType ?? "video/mp4",
							preset: options.preset ?? "default",
							outputQualities: options.outputQualities,
						},
					}),
				catch: (error) => new UploadError("Failed to request upload URL", error),
			});

			if (!uploadRequest.ok) {
				const errorText = yield* Effect.tryPromise({
					try: () => uploadRequest.text(),
					catch: (error) => new UploadError("Failed to read error response", error),
				}).pipe(Effect.orElse(() => Effect.succeed("Unknown error")));

				return yield* Effect.fail(
					new UploadError(`Upload request failed: ${uploadRequest.status} ${errorText}`),
				);
			}

			const uploadData = yield* Effect.tryPromise({
				try: () => uploadRequest.json() as Promise<{ jobId: string; uploadUrl: string; expiresAt: number }>,
				catch: (error) => new UploadError("Failed to parse upload response", error),
			});

			// Step 2: Upload file to R2 using presigned URL
			const uploadResponse = yield* Effect.tryPromise({
				try: () =>
					fetch(uploadData.uploadUrl, {
						method: "PUT",
						body: blob,
						headers: {
							"Content-Type": options.contentType ?? blob.type ?? "video/mp4",
						},
					}),
				catch: (error) => new UploadError("Failed to upload file to R2", error),
			});

			if (!uploadResponse.ok) {
				const errorText = yield* Effect.tryPromise({
					try: () => uploadResponse.text(),
					catch: (error) => new UploadError("Failed to read error response", error),
				}).pipe(Effect.orElse(() => Effect.succeed("Unknown error")));

				return yield* Effect.fail(
					new UploadError(`R2 upload failed: ${uploadResponse.status} ${errorText}`),
				);
			}

			// Step 3: Return job ID
			return {
				jobId: uploadData.jobId,
				status: "uploading" as const,
			} satisfies UploadResponse;
		});
	}

	/**
	 * Get the current status of a transcoding job.
	 *
	 * @param jobId - Job ID returned from upload()
	 * @returns Effect that resolves to current job status
	 *
	 * @example
	 * ```ts
	 * const status = await Effect.runPromise(
	 *   client.getStatus(jobId)
	 * );
	 * console.log(status.status); // "completed", "running", etc.
	 * ```
	 */
	getStatus(jobId: string): Effect.Effect<JobStatus, StatusError> {
		const client = this.client;
		return Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				try: () =>
					client.api.jobs[":jobId"].$get({
						param: { jobId },
					}),
				catch: (error) => new StatusError("Failed to fetch job status", error),
			});

			if (!response.ok) {
				if (response.status === 404) {
					return yield* Effect.fail(new StatusError(`Job not found: ${jobId}`));
				}

				const errorText = yield* Effect.tryPromise({
					try: () => response.text(),
					catch: (error) => new StatusError("Failed to read error response", error),
				}).pipe(Effect.orElse(() => Effect.succeed("Unknown error")));

				return yield* Effect.fail(
					new StatusError(`Status request failed: ${response.status} ${errorText}`),
				);
			}

			const jobStatus = yield* Effect.tryPromise({
				try: () => response.json() as Promise<JobStatus>,
				catch: (error) => new StatusError("Failed to parse job status", error),
			});

			return jobStatus;
		});
	}
}

