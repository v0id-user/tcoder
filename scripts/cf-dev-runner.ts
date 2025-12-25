/**
 * Cloudflare Dev Runner
 *
 * Runs wrangler dev and scheduled trigger concurrently using Bun and Effect.
 */

import { Console, Effect } from "effect";
import { program as triggerProgram } from "./trigger-scheduled";

const runCommand = (command: string, args: string[], cwd?: string) =>
	Effect.gen(function* () {
		yield* Console.log(`[CF Dev Runner] Starting: ${command} ${args.join(" ")}`);

		return new Promise<void>((resolve, reject) => {
			const proc = Bun.spawn({
				cmd: [command, ...args],
				cwd,
				stdout: "inherit",
				stderr: "inherit",
			});

			proc.exited.then((code) => {
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
	// Start trigger program in background using Effect.fork
	yield* Effect.fork(
		triggerProgram.pipe(Effect.catchAll((error) => Console.error(`[CF Dev Runner] Trigger error: ${error}`))),
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

