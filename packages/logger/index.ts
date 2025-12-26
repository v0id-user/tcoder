/**
 * Shared Logger Service for TCoder
 *
 * Provides structured, Effect-based logging with context injection.
 * Supports log levels, metadata, and scoped loggers for components, machines, and jobs.
 */

import { Context, Effect, Layer, Logger, LogLevel } from "effect";

// =============================================================================
// Types
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
	readonly component: string;
	readonly machineId?: string;
	readonly jobId?: string;
	readonly [key: string]: unknown;
}

export interface LoggerConfig {
	readonly component: string;
	readonly machineId?: string;
	readonly jobId?: string;
	readonly logLevel?: LogLevel;
}

export interface LogMetadata {
	readonly [key: string]: unknown;
}

// =============================================================================
// Logger Service
// =============================================================================

type LoggerServiceType = {
	info: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	warn: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	error: (message: string, error?: unknown, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	debug: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	withContext: (context: Partial<LoggerContext>) => LoggerService;
};

export class LoggerService extends Context.Tag("LoggerService")<LoggerService, LoggerServiceType>() {}

// =============================================================================
// Log Level Priority
// =============================================================================

const logLevelPriority: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const shouldLog = (configLevel: LogLevel, messageLevel: LogLevel): boolean => {
	return logLevelPriority[messageLevel] >= logLevelPriority[configLevel];
};

// =============================================================================
// Format Log Message
// =============================================================================

const formatLogMessage = (context: LoggerContext, message: string, metadata?: LogMetadata): string => {
	const parts: string[] = [];

	// Component prefix
	parts.push(`[${context.component}]`);

	// Machine ID if present
	if (context.machineId) {
		parts.push(`machine:${context.machineId}`);
	}

	// Job ID if present
	if (context.jobId) {
		parts.push(`job:${context.jobId}`);
	}

	// Message
	parts.push(message);

	// Metadata as JSON if present
	if (metadata && Object.keys(metadata).length > 0) {
		parts.push(JSON.stringify(metadata));
	}

	return parts.join(" ");
};

// =============================================================================
// Logger Implementation
// =============================================================================

// Type for logger service implementation (not the Tag)
type LoggerImpl = {
	info: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	warn: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	error: (message: string, error?: unknown, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	debug: (message: string, metadata?: LogMetadata) => Effect.Effect<void, never, never>;
	withContext: (context: Partial<LoggerContext>) => LoggerService;
};

const createLogger = (config: LoggerConfig): LoggerImpl => {
	const baseContext: LoggerContext = {
		component: config.component,
		...(config.machineId && { machineId: config.machineId }),
		...(config.jobId && { jobId: config.jobId }),
	};

	const logLevel = config.logLevel || "info";

	const info = (message: string, metadata?: LogMetadata): Effect.Effect<void, never, never> => {
		if (!shouldLog(logLevel, "info")) {
			return Effect.void;
		}
		const formatted = formatLogMessage(baseContext, message, metadata);
		return Effect.log(formatted);
	};

	const warn = (message: string, metadata?: LogMetadata): Effect.Effect<void, never, never> => {
		if (!shouldLog(logLevel, "warn")) {
			return Effect.void;
		}
		const formatted = formatLogMessage(baseContext, message, metadata);
		return Effect.logWarning(formatted);
	};

	const error = (message: string, error?: unknown, metadata?: LogMetadata): Effect.Effect<void, never, never> => {
		if (!shouldLog(logLevel, "error")) {
			return Effect.void;
		}
		const formatted = formatLogMessage(baseContext, message, metadata);
		const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined;
		if (errorMessage) {
			return Effect.logError(`${formatted} - Error: ${errorMessage}`);
		}
		return Effect.logError(formatted);
	};

	const debug = (message: string, metadata?: LogMetadata): Effect.Effect<void, never, never> => {
		if (!shouldLog(logLevel, "debug")) {
			return Effect.void;
		}
		const formatted = formatLogMessage(baseContext, message, metadata);
		return Effect.logDebug(formatted);
	};

	const withContext = (additionalContext: Partial<LoggerContext>): LoggerService => {
		const mergedContext: LoggerContext = {
			...baseContext,
			...additionalContext,
		};

		const mergedConfig: LoggerConfig = {
			component: mergedContext.component,
			machineId: mergedContext.machineId,
			jobId: mergedContext.jobId,
			logLevel: config.logLevel,
		};

		return createLogger(mergedConfig) as unknown as LoggerService;
	};

	return {
		info,
		warn,
		error,
		debug,
		withContext,
	};
};

// =============================================================================
// Layer Factory
// =============================================================================

export const makeLoggerLayer = (config: LoggerConfig): Layer.Layer<LoggerService> =>
	Layer.succeed(LoggerService, createLogger(config) as unknown as LoggerServiceType);

// =============================================================================
// Effect Logger Configuration
// =============================================================================

/**
 * Maps custom log levels to Effect's log levels.
 */
const mapToEffectLogLevel = (level: LogLevel): LogLevel.LogLevel => {
	switch (level) {
		case "debug":
			return LogLevel.Debug;
		case "info":
			return LogLevel.Info;
		case "warn":
			return LogLevel.Warning;
		case "error":
			return LogLevel.Error;
		default:
			return LogLevel.Info;
	}
};

/**
 * Creates an Effect logger layer configured with the minimum log level.
 * This ensures that Effect's runtime logger respects the LOG_LEVEL configuration
 * and doesn't filter out debug/warn/error logs.
 */
export const makeEffectLoggerLayer = (logLevel: LogLevel): Layer.Layer<never> => {
	const effectLogLevel = mapToEffectLogLevel(logLevel);
	return Logger.minimumLogLevel(effectLogLevel);
};

// =============================================================================
// Helper Functions for Common Logging Scenarios
// =============================================================================

/**
 * Log machine creation event
 */
export const logMachineCreated = (logger: LoggerImpl, machineId: string, region: string): Effect.Effect<void, never, never> =>
	logger.info("Machine created", {
		machineId,
		region,
		event: "machine.created",
	});

/**
 * Log machine status change
 */
export const logMachineStatus = (
	logger: LoggerImpl,
	machineId: string,
	state: string,
	metadata?: LogMetadata,
): Effect.Effect<void, never, never> =>
	logger.info("Machine status changed", {
		machineId,
		state,
		event: "machine.status",
		...metadata,
	});

/**
 * Log job processing started
 */
export const logJobStarted = (logger: LoggerImpl, jobId: string, inputUrl: string, preset?: string): Effect.Effect<void, never, never> =>
	logger.info("Job started", {
		jobId,
		inputUrl,
		preset,
		event: "job.started",
	});

/**
 * Log job completion
 */
export const logJobCompleted = (
	logger: LoggerImpl,
	jobId: string,
	duration: number,
	outputs: Array<{ quality: string; url: string }>,
): Effect.Effect<void, never, never> =>
	logger.info("Job completed", {
		jobId,
		duration,
		outputCount: outputs.length,
		outputs: outputs.map((o) => ({ quality: o.quality, url: o.url })),
		event: "job.completed",
	});

/**
 * Log job failure
 */
export const logJobFailed = (logger: LoggerImpl, jobId: string, error: string, duration: number): Effect.Effect<void, never, never> =>
	logger.error("Job failed", error, {
		jobId,
		duration,
		event: "job.failed",
	});

/**
 * Log worker started
 */
export const logWorkerStarted = (logger: LoggerImpl, machineId: string): Effect.Effect<void, never, never> =>
	logger.info("Worker started", {
		machineId,
		event: "worker.started",
	});

/**
 * Log worker stopped
 */
export const logWorkerStopped = (logger: LoggerImpl, machineId: string, jobsProcessed: number): Effect.Effect<void, never, never> =>
	logger.info("Worker stopped", {
		machineId,
		jobsProcessed,
		event: "worker.stopped",
	});

/**
 * Log lease initialization
 */
export const logLeaseInitialized = (logger: LoggerImpl, machineId: string): Effect.Effect<void, never, never> =>
	logger.info("Lease initialized", {
		machineId,
		event: "lease.initialized",
	});

/**
 * Log lease state update
 */
export const logLeaseStateUpdate = (logger: LoggerImpl, machineId: string, state: "running" | "idle"): Effect.Effect<void, never, never> =>
	logger.debug("Lease state updated", {
		machineId,
		state,
		event: "lease.state",
	});

/**
 * Log lease cleanup
 */
export const logLeaseCleanup = (logger: LoggerImpl, machineId: string): Effect.Effect<void, never, never> =>
	logger.info("Lease cleaned up", {
		machineId,
		event: "lease.cleanup",
	});

/**
 * Log R2 download operation
 */
export const logR2Download = (logger: LoggerImpl, url: string, localPath: string, sizeBytes?: number): Effect.Effect<void, never, never> =>
	logger.info("R2 download", {
		url,
		localPath,
		sizeBytes,
		sizeMB: sizeBytes ? (sizeBytes / 1024 / 1024).toFixed(2) : undefined,
		event: "r2.download",
	});

/**
 * Log R2 upload operation
 */
export const logR2Upload = (
	logger: LoggerImpl,
	localPath: string,
	r2Key: string,
	r2Url: string,
	sizeBytes?: number,
): Effect.Effect<void, never, never> =>
	logger.info("R2 upload", {
		localPath,
		r2Key,
		r2Url,
		sizeBytes,
		sizeMB: sizeBytes ? (sizeBytes / 1024 / 1024).toFixed(2) : undefined,
		event: "r2.upload",
	});

/**
 * Log webhook notification
 */
export const logWebhookNotification = (
	logger: LoggerImpl,
	webhookUrl: string,
	jobId: string,
	status: "completed" | "failed",
	httpStatus?: number,
): Effect.Effect<void, never, never> =>
	logger.info("Webhook notification sent", {
		webhookUrl,
		jobId,
		status,
		httpStatus,
		event: "webhook.sent",
	});

/**
 * Log webhook error
 */
export const logWebhookError = (logger: LoggerImpl, webhookUrl: string, jobId: string, error: unknown): Effect.Effect<void, never, never> =>
	logger.error("Webhook notification failed", error, {
		webhookUrl,
		jobId,
		event: "webhook.error",
	});
