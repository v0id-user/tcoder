/**
 * R2 Storage Client Service
 *
 * Handles downloading input videos from R2 and uploading transcoded outputs.
 * Uses Effect patterns for typed error handling and dependency injection.
 *
 * TODO: Implement actual R2 SDK integration
 * - Replace mock implementations with @aws-sdk/client-s3 (R2-compatible)
 * - Configure with R2 credentials from environment
 * - Handle presigned URLs vs direct bucket access
 */

import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Context, Effect, Layer, pipe } from "effect";

// R2 Configuration
interface R2Config {
	readonly accountId: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly bucketName: string;
	readonly endpoint?: string; // R2 endpoint URL
}

// R2 Client Service Tag
export class R2ClientService extends Context.Tag("R2ClientService")<
	R2ClientService,
	{
		download: (url: string, localPath: string) => Effect.Effect<void, R2Error, never>;
		upload: (localPath: string, r2Key: string, metadata?: Record<string, string>) => Effect.Effect<string, R2Error, never>; // Returns R2 URL
	}
>() {}

// R2 Error Types
type R2Error =
	| { _tag: "DownloadFailed"; url: string; reason: string }
	| { _tag: "UploadFailed"; key: string; reason: string }
	| { _tag: "FileNotFound"; path: string }
	| { _tag: "InvalidConfig"; field: string };

// Parse R2 configuration from environment
const getR2Config = Effect.sync((): R2Config => {
	const accountId = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucketName = process.env.R2_BUCKET_NAME;
	const endpoint = process.env.R2_ENDPOINT;

	if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
		throw new Error("Missing R2 configuration: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME");
	}

	return {
		accountId,
		accessKeyId,
		secretAccessKey,
		bucketName,
		endpoint,
	};
});

// Mock download implementation
// TODO: Replace with actual R2 SDK download
const downloadFromR2 = (url: string, localPath: string): Effect.Effect<void, R2Error, never> =>
	pipe(
		Effect.gen(function* () {
			yield* Console.log(`[R2] Downloading from ${url} to ${localPath}`);

			// Check if URL is a presigned URL or direct R2 URL
			const isPresignedUrl = url.includes("?");
			const isDirectR2Url = url.includes("r2.cloudflarestorage.com");

			if (isPresignedUrl || isDirectR2Url) {
				// Download via HTTP fetch (presigned URL or public URL)
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

				yield* Console.log(`[R2] Download completed: ${localPath}`);
			} else {
				// TODO: Implement direct bucket access using R2 SDK
				// For now, treat as local file path (fallback for testing)
				yield* Console.log(`[R2] WARNING: Treating as local path (not implemented): ${url}`);
				return yield* Effect.fail({
					_tag: "DownloadFailed",
					url,
					reason: "Direct bucket access not yet implemented",
				} as R2Error);
			}
		}),
		Effect.asVoid,
	);

// Mock upload implementation
// TODO: Replace with actual R2 SDK upload
const uploadToR2 = (localPath: string, r2Key: string, metadata?: Record<string, string>) =>
	Effect.gen(function* () {
		yield* Console.log(`[R2] Uploading ${localPath} to R2 key: ${r2Key}`);

		// Verify local file exists
		const fileStats = yield* Effect.tryPromise({
			try: () => stat(localPath),
			catch: () =>
				({
					_tag: "FileNotFound",
					path: localPath,
				}) as R2Error,
		});

		yield* Console.log(`[R2] File size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

		// TODO: Implement actual R2 SDK upload
		// const config = yield* getR2Config;
		// const s3Client = new S3Client({ ... });
		// const command = new PutObjectCommand({ ... });
		// await s3Client.send(command);

		// Mock: Return constructed R2 URL
		const config = yield* getR2Config;
		const r2Url = config.endpoint
			? `${config.endpoint}/${r2Key}`
			: `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucketName}/${r2Key}`;

		yield* Console.log(`[R2] Upload completed: ${r2Url}`);

		return r2Url;
	});

// Create R2 Client Service Layer
export const makeR2ClientLayer = Layer.effect(
	R2ClientService,
	Effect.gen(function* () {
		const config = yield* getR2Config;

		return {
			download: (url: string, localPath: string) => downloadFromR2(url, localPath),
			upload: (localPath: string, r2Key: string, metadata?: Record<string, string>) => uploadToR2(localPath, r2Key, metadata),
		};
	}),
);

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
