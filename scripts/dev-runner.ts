/**
 * Development Runner
 *
 * Runs Cloudflare worker and Docker Compose concurrently using Bun and Effect.
 */

import { Console, Effect } from "effect";

const runCommand = (command: string, args: string[], cwd?: string) =>
	Effect.gen(function* () {
		yield* Console.log(`[Dev Runner] Starting: ${command} ${args.join(" ")}`);

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
	// Start Docker Compose in background
	yield* Effect.fork(
		runCommand("docker-compose", ["up"], process.cwd()).pipe(Effect.catchAll((error) => Console.error(`[Dev Runner] Docker error: ${error}`))),
	);

	// Wait a bit for Docker to start
	yield* Effect.sleep("3 seconds");

	// Start Cloudflare worker (which includes the trigger script)
	// This runs in foreground - when it exits, we exit
	yield* runCommand("bun", ["run", "dev:cf"], process.cwd());
});

Effect.runPromise(program).catch((error) => {
	console.error("[Dev Runner] Fatal error:", error);
	process.exit(1);
});

