/**
 * R2 Storage Client Service
 *
 * Handles downloading input videos from R2 and uploading transcoded outputs.
 * Uses Effect patterns for typed error handling and dependency injection.
 * Implements Cloudflare R2 S3 API compatibility using AWS S3 SDK.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schedule, pipe } from "effect";
import { LoggerService, logR2Download, logR2Upload } from "../../packages/logger";

// R2 Configuration
interface R2Config {
	readonly accountId: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly bucketName: string;
	readonly endpoint?: string; // R2 endpoint URL
}

// S3 Client Service Tag (internal, for dependency injection)
class S3ClientService extends Context.Tag("S3ClientService")<S3ClientService, { readonly client: S3Client }>() {}

// R2 Client Service Tag
export class R2ClientService extends Context.Tag("R2ClientService")<
	R2ClientService,
	{
		download: (url: string, localPath: string) => Effect.Effect<void, R2Error, LoggerService>;
		upload: (localPath: string, r2Key: string, metadata?: Record<string, string>) => Effect.Effect<string, R2Error, LoggerService>; // Returns R2 URL
	}
>() {}

// R2 Error Types
type R2Error =
	| { _tag: "DownloadFailed"; url: string; reason: string }
	| { _tag: "UploadFailed"; key: string; reason: string }
	| { _tag: "FileNotFound"; path: string }
	| { _tag: "InvalidConfig"; field: string }
	| { _tag: "S3ClientError"; operation: string; reason: string }
	| { _tag: "Timeout"; operation: string };

// Parse R2 configuration from environment
const getR2Config = Effect.sync((): R2Config => {
	const accountId = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	// Support both R2_OUTPUT_BUCKET_NAME (new) and R2_BUCKET_NAME (legacy)
	const bucketName = process.env.R2_OUTPUT_BUCKET_NAME || process.env.R2_BUCKET_NAME;
	const endpoint = process.env.R2_ENDPOINT;

	const missing: string[] = [];
	if (!accountId) missing.push("R2_ACCOUNT_ID");
	if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
	if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
	if (!bucketName) missing.push("R2_OUTPUT_BUCKET_NAME");

	if (missing.length > 0) {
		// Use console.error here as this is called during module initialization
		// before Effect runtime is available
		console.error("Missing environment variables:", missing.join(", "));
		process.exit(1);
	}

	// At this point, we know all required values are defined (we exit if not)
	return {
		accountId: accountId as string,
		accessKeyId: accessKeyId as string,
		secretAccessKey: secretAccessKey as string,
		bucketName: bucketName as string,
		endpoint,
	};
});

// Extract bucket and key from R2 URL
const parseR2Url = (url: string): { bucket: string; key: string } | null => {
	try {
		const urlObj = new URL(url);
		if (urlObj.hostname.includes("r2.cloudflarestorage.com")) {
			// Format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>/<KEY>
			const pathParts = urlObj.pathname.split("/").filter(Boolean);
			if (pathParts.length >= 2) {
				return {
					bucket: pathParts[0],
					key: pathParts.slice(1).join("/"),
				};
			}
		}
		return null;
	} catch {
		return null;
	}
};

// Infer content type from file extension
const getContentType = (key: string): string => {
	const ext = key.split(".").pop()?.toLowerCase();
	const contentTypes: Record<string, string> = {
		mp4: "video/mp4",
		webm: "video/webm",
		mkv: "video/x-matroska",
		avi: "video/x-msvideo",
		mov: "video/quicktime",
		m3u8: "application/vnd.apple.mpegurl",
		ts: "video/mp2t",
	};
	return contentTypes[ext || ""] || "application/octet-stream";
};

// Retry schedule for R2 operations (exponential backoff, max 3 retries)
const r2RetrySchedule = Schedule.exponential("1 second").pipe(Schedule.intersect(Schedule.recurs(3)));

// Download implementation with presigned URL and direct bucket access support
const downloadFromR2 = (url: string, localPath: string): Effect.Effect<void, R2Error, LoggerService | S3ClientService> =>
	pipe(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			yield* logger.debug("Starting R2 download", { url, localPath });

			// Check if URL is a presigned URL or direct R2 URL
			const isPresignedUrl = url.includes("?");
			const parsedR2Url = parseR2Url(url);

			if (isPresignedUrl) {
				// Download via HTTP fetch (presigned URL)
				const response = yield* Effect.tryPromise({
					try: async () => {
						const res = await fetch(url);
						if (!res.ok) {
							throw new Error(`HTTP ${res.status}: ${res.statusText}`);
						}
						return res;
					},
					catch: (error) =>
						({
							_tag: "DownloadFailed",
							url,
							reason: error instanceof Error ? error.message : String(error),
						}) as R2Error,
				});

				const arrayBuffer = yield* Effect.tryPromise({
					try: () => response.arrayBuffer(),
					catch: (error) =>
						({
							_tag: "DownloadFailed",
							url,
							reason: error instanceof Error ? error.message : String(error),
						}) as R2Error,
				});

				yield* Effect.tryPromise({
					try: () => writeFile(localPath, Buffer.from(arrayBuffer)),
					catch: (error) =>
						({
							_tag: "DownloadFailed",
							url,
							reason: error instanceof Error ? error.message : String(error),
						}) as R2Error,
				});
			} else if (parsedR2Url) {
				// Direct bucket access using S3 SDK
				const { client } = yield* S3ClientService;
				const { bucket, key } = parsedR2Url;

				const command = new GetObjectCommand({
					Bucket: bucket,
					Key: key,
				});

				const response = yield* Effect.tryPromise({
					try: async () => await client.send(command),
					catch: (error) => {
						const reason = error instanceof Error ? error.message : String(error);
						return {
							_tag: "S3ClientError" as const,
							operation: "GetObject",
							reason,
						} as R2Error;
					},
				});

				if (!response.Body) {
					return yield* Effect.fail({
						_tag: "DownloadFailed",
						url,
						reason: "Empty response body",
					} as R2Error);
				}

				// Convert stream to buffer and write to file
				// AWS SDK v3 returns a Readable stream in Node.js
				const stream = response.Body as Readable;
				const chunks: Buffer[] = [];

				yield* Effect.tryPromise({
					try: () =>
						new Promise<void>((resolve, reject) => {
							stream.on("data", (chunk: Buffer) => chunks.push(chunk));
							stream.on("end", () => resolve());
							stream.on("error", reject);
						}),
					catch: (error) =>
						({
							_tag: "DownloadFailed",
							url,
							reason: error instanceof Error ? error.message : String(error),
						}) as R2Error,
				});

				const buffer = Buffer.concat(chunks);
				yield* Effect.tryPromise({
					try: () => writeFile(localPath, buffer),
					catch: (error) =>
						({
							_tag: "DownloadFailed",
							url,
							reason: error instanceof Error ? error.message : String(error),
						}) as R2Error,
				});
			} else {
				// Invalid URL format
				return yield* Effect.fail({
					_tag: "DownloadFailed",
					url,
					reason: "Invalid R2 URL format. Expected presigned URL or direct R2 URL.",
				} as R2Error);
			}

			// Verify file was written and log
			const fileStats = yield* Effect.tryPromise({
				try: () => stat(localPath),
				catch: () =>
					({
						_tag: "FileNotFound" as const,
						path: localPath,
					}) as R2Error,
			}).pipe(Effect.catchAll(() => Effect.succeed(null)));

			const sizeBytes = fileStats?.size;
			yield* logR2Download(logger, url, localPath, sizeBytes);
		}),
		Effect.retry(r2RetrySchedule),
		Effect.timeout("5 minutes"),
		Effect.mapError((error) => {
			if (error._tag === "TimeoutException") {
				return {
					_tag: "Timeout" as const,
					operation: "download",
				} as R2Error;
			}
			return error;
		}),
		Effect.asVoid,
	);

// Upload implementation using S3 SDK
const uploadToR2 = (
	localPath: string,
	r2Key: string,
	metadata?: Record<string, string>,
): Effect.Effect<string, R2Error, LoggerService | S3ClientService> =>
	pipe(
		Effect.gen(function* () {
			const logger = yield* LoggerService;
			const { client } = yield* S3ClientService;
			const config = yield* getR2Config;

			yield* logger.debug("Starting R2 upload", { localPath, r2Key, metadata });

			// Verify local file exists
			const fileStats = yield* Effect.tryPromise({
				try: () => stat(localPath),
				catch: () =>
					({
						_tag: "FileNotFound",
						path: localPath,
					}) as R2Error,
			});

			// Read file content
			const fileBuffer = yield* Effect.tryPromise({
				try: () => readFile(localPath),
				catch: (error) =>
					({
						_tag: "UploadFailed",
						key: r2Key,
						reason: error instanceof Error ? error.message : String(error),
					}) as R2Error,
			});

			// Prepare metadata (convert to S3 metadata format)
			const s3Metadata: Record<string, string> = {};
			if (metadata) {
				for (const [key, value] of Object.entries(metadata)) {
					s3Metadata[`x-amz-meta-${key}`] = value;
				}
			}

			// Upload to R2 using PutObjectCommand
			const command = new PutObjectCommand({
				Bucket: config.bucketName,
				Key: r2Key,
				Body: fileBuffer,
				ContentType: getContentType(r2Key),
				Metadata: s3Metadata,
			});

			yield* Effect.tryPromise({
				try: async () => await client.send(command),
				catch: (error) => {
					const reason = error instanceof Error ? error.message : String(error);
					return {
						_tag: "S3ClientError" as const,
						operation: "PutObject",
						reason,
					} as R2Error;
				},
			});

			// Construct and return R2 URL
			const r2Url = config.endpoint
				? `${config.endpoint}/${r2Key}`
				: `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${r2Key}`;

			yield* logR2Upload(logger, localPath, r2Key, r2Url, fileStats.size);

			return r2Url;
		}),
		Effect.retry(r2RetrySchedule),
		Effect.timeout("10 minutes"),
		Effect.mapError((error) => {
			if (error._tag === "TimeoutException") {
				return {
					_tag: "Timeout" as const,
					operation: "upload",
				} as R2Error;
			}
			return error;
		}),
	);

// Create S3 Client Layer (internal)
const makeS3ClientLayer = Layer.effect(
	S3ClientService,
	Effect.gen(function* () {
		const config = yield* getR2Config;

		const endpoint = config.endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`;

		const client = new S3Client({
			region: "auto", // R2 requires "auto" region
			endpoint,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			forcePathStyle: false, // R2 uses virtual-hosted-style URLs
		});

		return { client };
	}),
);

// Create R2 Client Service Layer
// Note: LoggerService must be provided separately (by the worker)
// S3ClientService is provided internally via layer composition
export const makeR2ClientLayer = Layer.effect(
	R2ClientService,
	Effect.gen(function* () {
		// Get S3ClientService from context to provide to download/upload
		const s3ClientService = yield* S3ClientService;

		return {
			download: (url: string, localPath: string) =>
				downloadFromR2(url, localPath).pipe(Effect.provide(Layer.succeed(S3ClientService, s3ClientService))),
			upload: (localPath: string, r2Key: string, metadata?: Record<string, string>) =>
				uploadToR2(localPath, r2Key, metadata).pipe(Effect.provide(Layer.succeed(S3ClientService, s3ClientService))),
		};
	}),
).pipe(Layer.provide(makeS3ClientLayer));

// Helper: Get temporary file path
export const getTempFilePath = (jobId: string, suffix: string) => join(tmpdir(), `ffmpeg-${jobId}-${suffix}`);

// Helper: Extract R2 key from URL
export const extractR2Key = (url: string): string => {
	try {
		const urlObj = new URL(url);
		// Remove leading slash from pathname
		return urlObj.pathname.replace(/^\//, "");
	} catch {
		// If not a valid URL, assume it's already a key
		return url;
	}
};
