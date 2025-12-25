/**
 * Cloudflare Dev Runner
 *
 * Runs wrangler dev and scheduled trigger concurrently.
 */

import { spawn } from "node:child_process";
import { Console, Effect } from "effect";

const runCommand = (command: string, args: string[], cwd?: string) =>
	Effect.gen(function* () {
		yield* Console.log(`[CF Dev Runner] Starting: ${command} ${args.join(" ")}`);

		return new Promise<void>((resolve, reject) => {
			const proc = spawn(command, args, {
				cwd,
				stdio: "inherit",
				shell: true,
			});

			proc.on("error", (error) => {
				reject(error);
			});

			proc.on("exit", (code) => {
				if (code === 0 || code === null) {
					resolve();
				} else {
					reject(new Error(`Process exited with code ${code}`));
				}
			});

			// Handle cleanup on process termination
			const cleanup = () => {
				proc.kill();
			};
			process.on("SIGINT", cleanup);
			process.on("SIGTERM", cleanup);
		});
	});

const program = Effect.gen(function* () {
	// Start trigger script in background
	yield* Effect.fork(
		runCommand("bun", ["run", "scripts/trigger-scheduled.ts"], process.cwd()).pipe(Effect.catchAll((error) => Console.error(`[CF Dev Runner] Trigger error: ${error}`))),
	);

	// Wait a bit for trigger script to initialize
	yield* Effect.sleep("2 seconds");

	// Start wrangler dev (foreground)
	yield* runCommand("wrangler", ["dev"], process.cwd());
});

Effect.runPromise(program).catch((error) => {
	console.error("[CF Dev Runner] Fatal error:", error);
	process.exit(1);
});

