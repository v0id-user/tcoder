/**
 * Concurrent Scheduled Trigger for Local Development
 *
 * Hits the Cloudflare Worker scheduled endpoint every 5 minutes
 * to simulate cron triggers during local development.
 *
 * Runs concurrently with wrangler dev.
 */

import { Console, Effect, Schedule } from "effect";

const PORT = process.env.PORT || "8787";
const SCHEDULED_URL = `http://127.0.0.1:${PORT}/cdn-cgi/handler/scheduled`;
const INTERVAL_MINUTES = 5;

const triggerScheduled = Effect.gen(function* () {
	yield* Console.log(`[Scheduled Trigger] Triggering scheduled endpoint: ${SCHEDULED_URL}`);

	const response = yield* Effect.tryPromise({
		try: async () => {
			const res = await fetch(SCHEDULED_URL, {
				method: "GET",
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText}`);
			}
			return res;
		},
		catch: (error) => new Error(`Failed to trigger scheduled: ${error instanceof Error ? error.message : String(error)}`),
	});

	const text = yield* Effect.tryPromise({
		try: () => response.text(),
		catch: (error) => new Error(`Failed to read response: ${error instanceof Error ? error.message : String(error)}`),
	});

	yield* Console.log(`[Scheduled Trigger] Response: ${text.substring(0, 200)}`);
});

const program = Effect.gen(function* () {
	yield* Console.log(`[Scheduled Trigger] Starting scheduled trigger (every ${INTERVAL_MINUTES} minutes)`);
	yield* Console.log(`[Scheduled Trigger] Target: ${SCHEDULED_URL}`);

	// Wait a bit for wrangler to start
	yield* Effect.sleep("5 seconds");

	// Run on schedule: every 5 minutes
	const schedule = Schedule.fixed(`${INTERVAL_MINUTES} minutes`);

	// Repeat the trigger effect according to the schedule forever
	yield* Effect.forever(
		Effect.gen(function* () {
			yield* triggerScheduled;
			yield* Effect.sleep(`${INTERVAL_MINUTES} minutes`);
		}),
	);
});

// Run the program
Effect.runPromise(program).catch((error) => {
	console.error("[Scheduled Trigger] Fatal error:", error);
	process.exit(1);
});

