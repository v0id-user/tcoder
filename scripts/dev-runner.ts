/**
 * Development Runner
 *
 * Runs everything for local development:
 * 1. Fly-worker container (Docker)
 * 2. Wrangler dev (API + queue handler)
 * 3. Scheduled trigger (every 5 minutes)
 *
 * Environment:
 * - .dev.vars → wrangler dev secrets
 * - .env → fly-worker container env vars
 */

import { Console, Effect, Schedule } from "effect";

const PORT = process.env.PORT || "8787";
const SCHEDULED_URL = `http://127.0.0.1:${PORT}/cdn-cgi/handler/scheduled`;
const INTERVAL_MINUTES = 5;

// Track spawned processes for cleanup
const processes: Array<ReturnType<typeof Bun.spawn>> = [];

const cleanup = () => {
	console.log("\n[Dev] Shutting down...");
	for (const proc of processes) {
		proc.kill();
	}
	process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

const runBackground = (name: string, command: string, args: string[]) =>
	Effect.sync(() => {
		console.log(`[Dev] Starting ${name}: ${command} ${args.join(" ")}`);
		const proc = Bun.spawn({
			cmd: [command, ...args],
			cwd: process.cwd(),
			stdout: "inherit",
			stderr: "inherit",
		});
		processes.push(proc);
		return proc;
	});

const runForeground = (command: string, args: string[]) =>
	Effect.async<void, Error>((resume) => {
		const proc = Bun.spawn({
			cmd: [command, ...args],
			cwd: process.cwd(),
			stdout: "inherit",
			stderr: "inherit",
		});
		processes.push(proc);

		proc.exited.then((code) => {
			if (code === 0 || code === null) {
				resume(Effect.succeed(undefined));
			} else {
				resume(Effect.fail(new Error(`Process exited with code ${code}`)));
			}
		});
	});

const triggerScheduled = Effect.gen(function* () {
	yield* Effect.tryPromise({
		try: async () => {
			const res = await fetch(SCHEDULED_URL);
			console.log(`[Trigger] ${res.ok ? "OK" : `HTTP ${res.status}`}`);
		},
		catch: (error) => {
			console.log(`[Trigger] Failed: ${error instanceof Error ? error.message : String(error)}`);
			return error;
		},
	});
}).pipe(Effect.catchAll(() => Effect.void));

const scheduledTriggerLoop = Effect.gen(function* () {
	// Wait for wrangler to start
	yield* Effect.sleep("5 seconds");
	yield* Console.log(`[Trigger] Running every ${INTERVAL_MINUTES} minutes`);

	// First trigger immediately, then repeat
	yield* triggerScheduled;
	yield* triggerScheduled.pipe(Effect.repeat(Schedule.spaced(`${INTERVAL_MINUTES} minutes`)));
});

const program = Effect.gen(function* () {
	yield* Console.log("┌────────────────────────────────────────┐");
	yield* Console.log("│  TCoder Local Development              │");
	yield* Console.log("├────────────────────────────────────────┤");
	yield* Console.log("│  API:        http://localhost:8787     │");
	yield* Console.log("│  Fly-worker: Docker container          │");
	yield* Console.log("│  Trigger:    Every 5 minutes           │");
	yield* Console.log("└────────────────────────────────────────┘");
	yield* Console.log("");

	// Start fly-worker container in background
	yield* runBackground("fly-worker", "docker-compose", ["up", "--build"]);
	yield* Effect.sleep("2 seconds");

	// Start scheduled trigger in background
	yield* Effect.fork(scheduledTriggerLoop);

	// Run wrangler dev (foreground - blocks until exit)
	yield* runForeground("bunx", ["wrangler", "dev"]);
});

Effect.runPromise(program).catch((error) => {
	console.error("[Dev] Fatal error:", error);
	cleanup();
});
