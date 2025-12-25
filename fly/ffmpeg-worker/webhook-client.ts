/**
 * Webhook Client Service
 *
 * Sends completion notifications to the Worker API when transcoding jobs finish.
 * Implements Phase 4 (Discoverability Phase) from the architecture diagram.
 *
 * TODO: Implement actual HTTP client integration
 * - Replace mock with Effect HTTP client or fetch wrapper
 * - Add retry logic with exponential backoff
 * - Add timeout handling
 * - Handle authentication if needed
 */

import { Console, Context, Effect, Layer, pipe } from "effect";

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
		notify: (payload: WebhookPayload) => Effect.Effect<void, WebhookError, never>;
	}
>() {}

// Webhook Error Types
type WebhookError =
	| { _tag: "WebhookFailed"; url: string; status: number; body: string }
	| { _tag: "InvalidWebhookUrl"; url: string }
	| { _tag: "NetworkError"; reason: string };

// Get webhook URL from environment (required)
const getWebhookUrl = Effect.sync((): string => {
	const url = process.env.WEBHOOK_URL;
	if (!url) {
		throw new Error("WEBHOOK_URL is required but not set");
	}
	return url;
});

// Mock webhook notification implementation
// TODO: Replace with actual HTTP client
const sendWebhook = (payload: WebhookPayload): Effect.Effect<void, WebhookError, never> =>
	pipe(
		Effect.gen(function* () {
			const webhookUrl = yield* getWebhookUrl;

			yield* Console.log(`[Webhook] Sending notification to ${webhookUrl}`);
			yield* Console.log(`[Webhook] Payload: ${JSON.stringify(payload, null, 2)}`);

			// TODO: Implement actual HTTP POST with Effect HTTP client
			// For now, use fetch wrapped in Effect
			const response = yield* Effect.tryPromise({
				try: async () => {
					const res = await fetch(webhookUrl, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							// TODO: Add authentication header if needed
							// "Authorization": `Bearer ${process.env.WEBHOOK_SECRET}`,
						},
						body: JSON.stringify(payload),
					});

					if (!res.ok) {
						const body = await res.text().catch(() => "");
						throw new Error(`HTTP ${res.status}: ${res.statusText}\n${body}`);
					}

					return res;
				},
				catch: (error) => {
					if (error instanceof Error) {
						if (error.message.includes("HTTP")) {
							const match = error.message.match(/HTTP (\d+):/);
							const status = match ? Number.parseInt(match[1], 10) : 0;
							return {
								_tag: "WebhookFailed",
								url: webhookUrl,
								status,
								body: error.message,
							} as WebhookError;
						}
						return {
							_tag: "NetworkError",
							reason: error.message,
						} as WebhookError;
					}
					return {
						_tag: "NetworkError",
						reason: String(error),
					} as WebhookError;
				},
			});

			yield* Console.log(`[Webhook] Notification sent successfully (${response.status})`);
		}),
		Effect.asVoid,
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
