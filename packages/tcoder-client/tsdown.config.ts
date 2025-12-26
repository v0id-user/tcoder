import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
	},
	format: ["esm", "cjs"],
	outDir: "dist",
	dts: true,
	minify: true,
	sourcemap: false,
	platform: "node",
	treeshake: true,
	clean: true,
	external: ["effect", "hono"],
});
