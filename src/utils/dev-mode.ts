/**
 * Dev Mode Detection Utility
 *
 * Centralized utility for detecting development mode across the application.
 * Dev mode is active when:
 * - FLY_API_TOKEN is missing or empty, OR
 * - NODE_ENV is set to "development"
 */

/**
 * Check if we're in dev mode (local development with Docker worker).
 *
 * Note: In Cloudflare Workers, process.env.NODE_ENV is not reliable and may
 * be set to "development" even in production. We only check token presence.
 *
 * @param flyApiToken - Fly API token. If missing or empty, we're in dev mode.
 * @returns true if in dev mode, false otherwise
 */
export const isDevMode = (flyApiToken?: string): boolean => {
	const tokenPresent = flyApiToken !== undefined && flyApiToken !== "";
	const isDev = !tokenPresent;

	console.log("[DevMode] Checking dev mode:", {
		tokenPresent,
		tokenLength: flyApiToken?.length ?? 0,
		isDev,
		note: "Only checking token presence (NODE_ENV not reliable in Cloudflare Workers)",
	});

	return isDev;
};

