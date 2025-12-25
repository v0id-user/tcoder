/**
 * Development Runner
 *
 * Runs Cloudflare worker and Docker Compose concurrently.
 */

import { spawn } from "node:child_process";
import { Console, Effect } from "effect";

const runCommand = (command: string, args: string[], cwd?: string) =>
	Effect.gen(function* () {
		yield* Console.log(`[Dev Runner] Starting: ${command} ${args.join(" ")}`);

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
	// Start Docker Compose in background
	const dockerProcess = yield* Effect.fork(
		runCommand("docker-compose", ["up"], process.cwd()).pipe(Effect.catchAll((error) => Console.error(`[Dev Runner] Docker error: ${error}`))),
	);

	// Wait a bit for Docker to start
	yield* Effect.sleep("3 seconds");

	// Start Cloudflare worker (which includes the trigger script)
	yield* runCommand("bun", ["run", "dev:cf"], process.cwd());

	// If we get here, wait for Docker process
	yield* Effect.await(dockerProcess);
});

Effect.runPromise(program).catch((error) => {
	console.error("[Dev Runner] Fatal error:", error);
	process.exit(1);
});

