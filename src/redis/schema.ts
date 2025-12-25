/**
 * Redis Schema Definitions for RWOS
 *
 * Defines key patterns, types, and builders for the Redis data model.
 * All keys follow a consistent naming convention for easy management.
 */

// =============================================================================
// Key Builders
// =============================================================================

export const RedisKeys = {
	/** Job queue - ZSET sorted by timestamp (priority) */
	jobsPending: "jobs:pending",

	/** Active jobs mapping - HASH: job_id -> machine_id */
	jobsActive: "jobs:active",

	/** Job status hash - HASH with job metadata */
	jobStatus: (jobId: string) => `jobs:status:${jobId}` as const,

	/** Worker leases - HASH: machine_id -> expiry timestamp */
	workersLeases: "workers:leases",

	/** Worker metadata - HASH with worker stats */
	workerMeta: (machineId: string) => `workers:meta:${machineId}` as const,

	/** Active machine counter - STRING */
	countersActiveMachines: "counters:active_machines",

	/** Rate limit counter - STRING with 1s TTL */
	countersRateLimit: "counters:rate_limit",
} as const;

// =============================================================================
// Job Types
// =============================================================================

/**
 * Job status flow:
 * uploading -> queued -> pending -> running -> completed
 *                                           -> failed
 */
export type JobStatus =
	| "uploading" // Presigned URL generated, waiting for upload
	| "queued" // Upload complete, waiting to be picked up
	| "pending" // In job queue, waiting for worker
	| "running" // Worker processing
	| "completed" // Done, outputs available
	| "failed"; // Error occurred

export interface JobTimestamps {
	readonly createdAt: number; // When job was created (presigned URL generated)
	readonly uploadedAt?: number; // When upload completed (R2 event received)
	readonly queuedAt?: number; // When added to job queue
	readonly startedAt?: number; // When worker started processing
	readonly completedAt?: number; // When processing finished
}

export interface JobOutput {
	readonly quality: string;
	readonly url: string;
	readonly size?: number;
}

export interface JobData {
	readonly jobId: string;
	readonly status: JobStatus;
	readonly machineId?: string;
	readonly inputKey: string; // R2 key for input file
	readonly inputUrl?: string; // Full URL (set after upload)
	readonly outputUrl: string; // Base output path
	readonly preset: string;
	readonly webhookUrl: string;
	readonly outputQualities?: string[];
	readonly outputs?: JobOutput[]; // Completed output files
	readonly filename?: string; // Original filename
	readonly contentType?: string;
	readonly timestamps: JobTimestamps;
	readonly error?: string;
	readonly retries: number;
	readonly r2Config?: {
		readonly accountId: string;
		readonly accessKeyId: string;
		readonly secretAccessKey: string;
		readonly bucketName: string;
		readonly endpoint?: string;
	};
}

export interface WorkerLease {
	readonly machineId: string;
	readonly expiresAt: number; // Unix timestamp ms
	readonly startedAt: number;
	readonly jobsProcessed: number;
	readonly maxJobs: number;
	readonly maxLifetimeMs: number;
}

export interface WorkerMeta {
	readonly machineId: string;
	readonly startedAt: number;
	readonly jobsProcessed: number;
	readonly lastJobAt?: number;
	readonly status: "active" | "draining" | "exiting";
}

// =============================================================================
// Configuration Constants
// =============================================================================

export const RWOS_CONFIG = {
	/** Maximum concurrent Fly machines */
	MAX_MACHINES: 5,

	/** Rate limit: 1 request per second for Fly API */
	RATE_LIMIT_WINDOW_MS: 1000,

	/** Machine TTL in milliseconds (5 minutes) */
	MACHINE_TTL_MS: 300_000,

	/** Maximum jobs per machine before drain */
	MAX_JOBS_PER_MACHINE: 3,

	/** Time buffer before TTL to start draining (60 seconds) */
	DRAIN_BUFFER_MS: 60_000,

	/** Job status TTL in seconds (24 hours) */
	JOB_STATUS_TTL_SECONDS: 86_400,

	/** Lease expiry buffer beyond machine TTL (30 seconds) */
	LEASE_BUFFER_MS: 30_000,

	/** Poll interval when waiting for jobs (5 seconds) */
	JOB_POLL_INTERVAL_MS: 5_000,

	/** Maximum retries for failed jobs */
	MAX_JOB_RETRIES: 3,

	/** Base delay for exponential backoff (100ms) */
	BACKOFF_BASE_MS: 100,

	/** Maximum backoff delay (10 seconds) */
	BACKOFF_MAX_MS: 10_000,

	/** Presigned URL expiry (1 hour) */
	PRESIGNED_URL_EXPIRY_SECONDS: 3600,
} as const;

// =============================================================================
// Serialization Helpers
// =============================================================================

export const serializeJobData = (job: JobData): Record<string, string> => ({
	jobId: job.jobId,
	status: job.status,
	...(job.machineId && { machineId: job.machineId }),
	inputKey: job.inputKey,
	...(job.inputUrl && { inputUrl: job.inputUrl }),
	outputUrl: job.outputUrl,
	preset: job.preset,
	webhookUrl: job.webhookUrl,
	...(job.outputQualities && {
		outputQualities: job.outputQualities.join(","),
	}),
	...(job.outputs && { outputs: JSON.stringify(job.outputs) }),
	...(job.filename && { filename: job.filename }),
	...(job.contentType && { contentType: job.contentType }),
	// Timestamps
	createdAt: String(job.timestamps.createdAt),
	...(job.timestamps.uploadedAt && {
		uploadedAt: String(job.timestamps.uploadedAt),
	}),
	...(job.timestamps.queuedAt && {
		queuedAt: String(job.timestamps.queuedAt),
	}),
	...(job.timestamps.startedAt && {
		startedAt: String(job.timestamps.startedAt),
	}),
	...(job.timestamps.completedAt && {
		completedAt: String(job.timestamps.completedAt),
	}),
	...(job.error && { error: job.error }),
	retries: String(job.retries),
	...(job.r2Config && { r2Config: JSON.stringify(job.r2Config) }),
});

export const deserializeJobData = (data: Record<string, string | null>): JobData | null => {
	if (!data.jobId) {
		return null;
	}

	return {
		jobId: data.jobId,
		status: (data.status as JobStatus) || "uploading",
		machineId: data.machineId || undefined,
		inputKey: data.inputKey || "",
		inputUrl: data.inputUrl || undefined,
		outputUrl: data.outputUrl || "",
		preset: data.preset || "default",
		webhookUrl: data.webhookUrl || "",
		outputQualities: data.outputQualities ? data.outputQualities.split(",") : undefined,
		outputs: data.outputs ? JSON.parse(data.outputs) : undefined,
		filename: data.filename || undefined,
		contentType: data.contentType || undefined,
		timestamps: {
			createdAt: Number(data.createdAt) || Date.now(),
			uploadedAt: data.uploadedAt ? Number(data.uploadedAt) : undefined,
			queuedAt: data.queuedAt ? Number(data.queuedAt) : undefined,
			startedAt: data.startedAt ? Number(data.startedAt) : undefined,
			completedAt: data.completedAt ? Number(data.completedAt) : undefined,
		},
		error: data.error || undefined,
		retries: Number(data.retries) || 0,
		r2Config: data.r2Config ? JSON.parse(data.r2Config) : undefined,
	};
};

export const serializeWorkerLease = (lease: WorkerLease): Record<string, string> => ({
	machineId: lease.machineId,
	expiresAt: String(lease.expiresAt),
	startedAt: String(lease.startedAt),
	jobsProcessed: String(lease.jobsProcessed),
	maxJobs: String(lease.maxJobs),
	maxLifetimeMs: String(lease.maxLifetimeMs),
});

export const deserializeWorkerLease = (data: Record<string, string | null>): WorkerLease | null => {
	if (!data.machineId || !data.expiresAt) {
		return null;
	}

	return {
		machineId: data.machineId,
		expiresAt: Number(data.expiresAt),
		startedAt: Number(data.startedAt) || Date.now(),
		jobsProcessed: Number(data.jobsProcessed) || 0,
		maxJobs: Number(data.maxJobs) || RWOS_CONFIG.MAX_JOBS_PER_MACHINE,
		maxLifetimeMs: Number(data.maxLifetimeMs) || RWOS_CONFIG.MACHINE_TTL_MS,
	};
};
