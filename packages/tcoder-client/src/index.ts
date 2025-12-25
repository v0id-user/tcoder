/**
 * Tcoder Client SDK
 *
 * Simple SDK for video transcoding: upload videos and check job status.
 */

export { TcoderClient } from "./tcoder";
export type {
	ClientConfig,
	JobOutput,
	JobStatus,
	UploadOptions,
	UploadResponse,
} from "./tcoder";
export { UploadError, StatusError } from "./tcoder";
