/**
 * Fly Machines API Client for Ephemeral FFmpeg Jobs
 *
 * Usage pattern:
 * 1. Deploy image once: `fly deploy --build-only`
 * 2. Trigger jobs via this client
 * 3. Each job creates a new machine
 * 4. Machine auto-stops when FFmpeg exits
 * 5. Billing only for execution time
 */

import { Context, Effect } from "effect";
import { flyClient } from "./fly-client";
import type { Components, Machine, Paths } from "./fly-machine-apis";
import { LoggerService, logMachineCreated, logMachineStatus, makeLoggerLayer } from "../packages/logger";

// Configuration
interface FlyConfig {
	readonly apiToken: string;
	readonly appName: string;
	readonly region: string;
}

class FlyConfigService extends Context.Tag("FlyConfigService")<FlyConfigService, FlyConfig>() {}

// Job parameters
interface TranscodeJob {
	readonly jobId: string;
	readonly inputUrl: string;
	readonly outputUrl: string;
	readonly preset?: string;
	readonly apiToken: string;
	// Required: Webhook URL for completion notification (Phase 4 - Discoverability Phase)
	readonly webhookUrl: string;
	// Optional: Multiple output qualities (e.g., ["480p", "720p", "1080p"])
	readonly outputQualities?: string[];
	// Optional: R2 configuration (if not using presigned URLs)
	readonly r2Config?: {
		readonly accountId: string;
		readonly accessKeyId: string;
		readonly secretAccessKey: string;
		readonly bucketName: string;
		readonly endpoint?: string;
	};
}

type FlyApiError =
	| { _tag: "HttpError"; status: number; body: string }
	| { _tag: "InvalidMachineResponse"; raw: unknown }
	| { _tag: "JobTimeout" };

// Create ephemeral machine for transcoding job
const createTranscodeMachine = (job: TranscodeJob) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const config = yield* FlyConfigService;
		const apiToken = job.apiToken;

		// Build environment variables for the machine
		const env: Record<string, string> = {
			JOB_ID: job.jobId,
			INPUT_URL: job.inputUrl,
			OUTPUT_URL: job.outputUrl,
			PRESET: job.preset || "default",
		};

		// Add webhook URL (required for Phase 4 - Discoverability Phase)
		env.WEBHOOK_URL = job.webhookUrl;

		// Add output qualities if provided
		if (job.outputQualities && job.outputQualities.length > 0) {
			env.OUTPUT_QUALITIES = job.outputQualities.join(",");
		}

		// Add R2 configuration if provided
		if (job.r2Config) {
			env.R2_ACCOUNT_ID = job.r2Config.accountId;
			env.R2_ACCESS_KEY_ID = job.r2Config.accessKeyId;
			env.R2_SECRET_ACCESS_KEY = job.r2Config.secretAccessKey;
			env.R2_OUTPUT_BUCKET_NAME = job.r2Config.bucketName;
			if (job.r2Config.endpoint) {
				env.R2_ENDPOINT = job.r2Config.endpoint;
			}
		}

		const request: Paths.MachinesCreate.RequestBody = {
			name: `ffmpeg-${job.jobId}`,
			region: config.region,
			config: {
				image: `registry.fly.io/${config.appName}:latest`,
				// Pass job parameters as environment variables to the machine
				env,
				guest: {
					cpu_kind: "shared",
					cpus: 1,
					memory_mb: 512,
					persist_rootfs: "never"
				},
				restart: {
					policy: "no",
				},
				auto_destroy: true,
			},
		};

		const machine = yield* Effect.tryPromise({
			try: () =>
				flyClient.Machines_create({ app_name: config.appName }, request, {
					headers: {
						Authorization: `Bearer ${apiToken}`,
					},
				}),
			catch: (e) => {
				const error: FlyApiError =
					e &&
					typeof e === "object" &&
					"response" in e &&
					e.response &&
					typeof e.response === "object" &&
					"status" in e.response &&
					"data" in e.response
						? {
								_tag: "HttpError",
								status: e.response.status as number,
								body: typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data),
							}
						: {
								_tag: "HttpError",
								status: 0,
								body: typeof e === "string" ? e : "Network error",
							};

				return error;
			},
		}).pipe(
			Effect.tapError((error) =>
				logger.error("Failed to create machine", error, {
					jobId: job.jobId,
					error: error._tag === "HttpError" ? `HTTP ${error.status}: ${error.body}` : String(error),
				}),
			),
		);

		if (!machine.data?.id) {
			const error: FlyApiError = {
				_tag: "InvalidMachineResponse",
				raw: machine.data,
			};
			yield* logger.error("Invalid machine response", undefined, {
				jobId: job.jobId,
				raw: machine.data,
			});
			return yield* Effect.fail(error);
		}

		const createdMachine = machine.data as Components.Schemas.Machine;
		yield* logMachineCreated(logger, createdMachine.instance_id ?? "Machine was created with no instance id", config.region);

		return createdMachine;
	});

// Get machine status
const getMachineStatus = (machineId: string, apiToken: string) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		const config = yield* FlyConfigService;

		const machine = yield* Effect.tryPromise({
			try: () =>
				flyClient.Machines_show(
					{
						app_name: config.appName,
						machine_id: machineId,
					},
					undefined,
					{
						headers: {
							Authorization: `Bearer ${apiToken}`,
						},
					},
				),
			catch: (e) => {
				const error: FlyApiError =
					e &&
					typeof e === "object" &&
					"response" in e &&
					e.response &&
					typeof e.response === "object" &&
					"status" in e.response &&
					"data" in e.response
						? {
								_tag: "HttpError",
								status: e.response.status as number,
								body: typeof e.response.data === "string" ? e.response.data : JSON.stringify(e.response.data),
							}
						: {
								_tag: "HttpError",
								status: 0,
								body: typeof e === "string" ? e : "Network error",
							};

				return error;
			},
		}).pipe(
			Effect.tapError((error) =>
				logger.error("Failed to get machine status", error, {
					machineId,
					error: error._tag === "HttpError" ? `HTTP ${error.status}: ${error.body}` : String(error),
				}),
			),
		);

		if (!machine.data?.id) {
			const error: FlyApiError = {
				_tag: "InvalidMachineResponse",
				raw: machine.data,
			};
			yield* logger.error("Invalid machine status response", undefined, {
				machineId,
				raw: machine.data,
			});
			return yield* Effect.fail(error);
		}

		const statusMachine = machine.data as Machine;
		yield* logMachineStatus(logger, statusMachine.id, statusMachine.state);

		return statusMachine;
	});

// Wait for machine to complete
const waitForCompletion = (machineId: string, apiToken: string) =>
	Effect.gen(function* () {
		const logger = yield* LoggerService;
		let attempts = 0;
		const maxAttempts = 120;

		while (attempts < maxAttempts) {
			const status = yield* getMachineStatus(machineId, apiToken);

			if (status.state === "stopped" || status.state === "destroyed") {
				yield* logMachineStatus(logger, status.id, status.state, {
					attempts,
					event: "machine.completed",
				});
				return status;
			}

			yield* Effect.sleep("5 seconds");
			attempts++;
		}

		yield* logger.error("Job timeout waiting for machine completion", undefined, {
			machineId,
			attempts,
			maxAttempts,
		});

		return yield* Effect.fail({
			_tag: "JobTimeout",
		} as FlyApiError);
	});

// Complete job execution flow
export const executeTranscodeJob = (job: TranscodeJob) =>
	Effect.gen(function* () {
		// Create and start machine
		const machine = yield* createTranscodeMachine(job);
		if (machine.instance_id === undefined){
			// TODO: make it an effect layer error and handle it more gracefully
			throw new Error("Machine was created with no instance id")
		}

		// Wait for completion
		const completed = yield* waitForCompletion(machine.instance_id, job.apiToken);

		return completed;
	});

/**
 * Create logger layer for fly-machines component
 */
export const makeFlyMachinesLoggerLayer = () =>
	makeLoggerLayer({
		component: "fly-machines",
	});
