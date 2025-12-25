/**
 * R2 Presigned URL Generation
 *
 * Generates presigned PUT URLs for direct client uploads to R2.
 * Uses AWS SDK v3 with R2-compatible S3 API.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// =============================================================================
// Types
// =============================================================================

export interface R2Config {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucketName: string;
}

export interface PresignedUploadResult {
	uploadUrl: string;
	key: string;
	expiresAt: number;
}

export interface PresignedDownloadResult {
	downloadUrl: string;
	expiresAt: number;
}

// =============================================================================
// R2 Client Factory
// =============================================================================

export const createR2Client = (config: R2Config): S3Client => {
	return new S3Client({
		region: "auto",
		endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
};

// =============================================================================
// Presigned URL Generation
// =============================================================================

/**
 * Generate a presigned PUT URL for uploading to R2.
 * Client can use this URL to upload directly to R2.
 */
export const generateUploadUrl = async (
	client: S3Client,
	bucketName: string,
	key: string,
	options: {
		expiresIn?: number; // seconds, default 1 hour
		contentType?: string;
	} = {},
): Promise<PresignedUploadResult> => {
	const expiresIn = options.expiresIn || 3600;

	const command = new PutObjectCommand({
		Bucket: bucketName,
		Key: key,
		...(options.contentType && { ContentType: options.contentType }),
	});

	const uploadUrl = await getSignedUrl(client, command, { expiresIn });

	return {
		uploadUrl,
		key,
		expiresAt: Date.now() + expiresIn * 1000,
	};
};

/**
 * Generate a presigned GET URL for downloading from R2.
 */
export const generateDownloadUrl = async (
	client: S3Client,
	bucketName: string,
	key: string,
	expiresIn = 3600,
): Promise<PresignedDownloadResult> => {
	const command = new GetObjectCommand({
		Bucket: bucketName,
		Key: key,
	});

	const downloadUrl = await getSignedUrl(client, command, { expiresIn });

	return {
		downloadUrl,
		expiresAt: Date.now() + expiresIn * 1000,
	};
};

// =============================================================================
// Key Generation Helpers
// =============================================================================

/**
 * Generate a unique input key for a job.
 * Format: inputs/{jobId}/{filename}
 */
export const generateInputKey = (jobId: string, filename: string): string => {
	// Sanitize filename
	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
	return `inputs/${jobId}/${safeName}`;
};

/**
 * Generate output key pattern for a job.
 * Format: outputs/{jobId}/{quality}.{ext}
 */
export const generateOutputKey = (jobId: string, quality: string, ext = "mp4"): string => {
	return `outputs/${jobId}/${quality}.${ext}`;
};

/**
 * Extract job ID from R2 object key.
 * Assumes format: inputs/{jobId}/... or outputs/{jobId}/...
 */
export const extractJobIdFromKey = (key: string): string | null => {
	const match = key.match(/^(?:inputs|outputs)\/([^/]+)\//);
	return match ? match[1] : null;
};
