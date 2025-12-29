/**
 * Webhook Client Service
 *
 * Sends completion notifications to the Worker API when transcoding jobs finish.
 * Implements Phase 4 (Discoverability Phase) from the architecture diagram.
 * Uses type-safe Hono RPC client with retry logic and timeout handling.
 */

import { Context, Effect, Layer, Schedule, pipe } from "effect";
import { LoggerService, logWebhookError, logWebhookNotification } from "../../packages/logger";
import { createClient } from "./client";

// Webhook payload structure
export interface WebhookPayload {
	readonly jobId: string;
	readonly status: "completed" | "failed";
	readonly inputUrl: string;
	readonly outputs: Array<{
		readonly quality: string;
		readonly url: string;
		readonly preset: string;
	}>;
	readonly error?: string;
	readonly duration?: number; // seconds
}

// Webhook Client Service Tag
export class WebhookClientService extends Context.Tag("WebhookClientService")<
	WebhookClientService,
	{
		notify: (payload: WebhookPayload) => Effect.Effect<void, never, LoggerService>;
	}
>() {}

// Webhook Error Types
type WebhookError =
	| { _tag: "WebhookFailed"; url: string; status: number; body: string }
	| { _tag: "InvalidWebhookUrl"; url: string }
	| { _tag: "NetworkError"; reason: string }
	| { _tag: "Timeout"; url: string };

// Extract base URL from WEBHOOK_URL (e.g., "http://host.docker.internal:8787/webhooks/job-complete" -> "http://host.docker.internal:8787")
// Returns Option<string> - None if WEBHOOK_URL is not set or invalid
const getBaseUrl = Effect.gen(function* () {
	const webhookUrl = process.env.WEBHOOK_URL;
	if (!webhookUrl) {
		return yield* Effect.succeed(null);
	}
	try {
		const url = new URL(webhookUrl);
		// Remove the path to get base URL
		url.pathname = "";
		return url.toString().replace(/\/$/, ""); // Remove trailing slash
	} catch (error) {
		// Invalid URL format, return null to skip webhook
		return yield* Effect.succeed(null);
	}
});

// Retry schedule: exponential backoff starting at 100ms, max 3 retries
// Only retry on network errors and 5xx status codes (not 4xx client errors)
const webhookRetrySchedule = Schedule.exponential("100 millis").pipe(
	Schedule.intersect(Schedule.recurs(3)),
	Schedule.whileInput<WebhookError>((err) => {
		if (err._tag === "NetworkError") return true;
		if (err._tag === "WebhookFailed" && err.status >= 500) return true;
		return false;
	}),
);

// Send webhook notification using type-safe RPC client
// Gracefully skips if WEBHOOK_URL is not set or invalid
const sendWebhook = (payload: WebhookPayload): Effect.Effect<void, never, LoggerService> =>
	pipe(
		getBaseUrl,
		Effect.flatMap((baseUrl) => {
			// If baseUrl is null, skip webhook (WEBHOOK_URL not set or invalid)
			if (!baseUrl) {
				return Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.debug("Skipping webhook notification - WEBHOOK_URL not set or invalid", {
						jobId: payload.jobId,
					});
				});
			}

			const webhookUrl = `${baseUrl}/webhooks/job-complete`;

			return pipe(
				Effect.gen(function* () {
					const logger = yield* LoggerService;

					yield* logger.debug("Sending webhook notification", {
						baseUrl,
						webhookUrl,
						payload,
					});

					// Create RPC client with base URL
					const client = createClient(baseUrl);

					// Call webhook endpoint using type-safe RPC client
					const response = yield* Effect.tryPromise({
						try: async () => {
							return await client.webhooks["job-complete"].$post({
								json: payload,
							});
						},
						catch: (error) => {
							// Network errors (connection failures, etc.)
							return {
								_tag: "NetworkError",
								reason: error instanceof Error ? error.message : String(error),
							} as WebhookError;
						},
					});

					// Check response status (RPC client returns Response object)
					if (!response.ok) {
						const errorBody = yield* Effect.tryPromise({
							try: () => response.text(),
							catch: () => "",
						}).pipe(Effect.orElse(() => Effect.succeed("")));

						return yield* Effect.fail({
							_tag: "WebhookFailed",
							url: webhookUrl,
							status: response.status,
							body: errorBody,
						} as WebhookError);
					}

					yield* logWebhookNotification(logger, webhookUrl, payload.jobId, payload.status, response.status);
				}),
				Effect.retry(webhookRetrySchedule),
				Effect.timeout("10 seconds"),
				Effect.mapError((error) => {
					// Map timeout errors to WebhookError
					if (error._tag === "TimeoutException") {
						return {
							_tag: "Timeout" as const,
							url: webhookUrl,
						} as WebhookError;
					}
					return error;
				}),
				Effect.catchAll((error) => {
					return Effect.gen(function* () {
						const logger = yield* LoggerService;
						yield* logWebhookError(logger, webhookUrl, payload.jobId, error);
						// Log error but don't fail - webhook is optional
						return Effect.void;
					});
				}),
				Effect.asVoid,
			);
		}),
	);

// Create Webhook Client Service Layer
export const makeWebhookClientLayer = Layer.effect(
	WebhookClientService,
	Effect.gen(function* () {
		return {
			notify: (payload: WebhookPayload) => sendWebhook(payload),
		};
	}),
);
