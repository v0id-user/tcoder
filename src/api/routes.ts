import { Hono } from "hono";
import { createJobRoutes } from "./jobs";
import { createStatsRoutes } from "./stats";
import { createUploadRoutes } from "./upload";
import { createWebhookRoutes } from "./webhooks";
import type { Env } from "./types";

const buildRoutes = () => {
	const uploadRoutes = createUploadRoutes();
	const jobRoutes = createJobRoutes();
	const statsRoutes = createStatsRoutes();

	return new Hono<{ Bindings: Env }>()
		.route("/", uploadRoutes)
		.route("/", jobRoutes)
		.route("/", statsRoutes);
};

export const createRoutes = (): ReturnType<typeof buildRoutes> => {
	return buildRoutes();
};

export { createWebhookRoutes };

