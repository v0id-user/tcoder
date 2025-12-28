import { Hono } from "hono";
import { createJobRoutes } from "./jobs";
import { createStatsRoutes } from "./stats";
import type { Env } from "./types";
import { createUploadRoutes } from "./upload";
import { createWebhookRoutes } from "./webhooks";

const buildRoutes = () => {
	const uploadRoutes = createUploadRoutes();
	const jobRoutes = createJobRoutes();
	const statsRoutes = createStatsRoutes();

	return new Hono<{ Bindings: Env }>().route("/", uploadRoutes).route("/", jobRoutes).route("/", statsRoutes);
};

export const createRoutes = (): ReturnType<typeof buildRoutes> => {
	return buildRoutes();
};

export { createWebhookRoutes };
