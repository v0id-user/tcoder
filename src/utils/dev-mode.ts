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
 * @param flyApiToken - Optional Fly API token. If not provided, checks process.env.NODE_ENV only.
 * @returns true if in dev mode, false otherwise
 */
export const isDevMode = (flyApiToken?: string): boolean => {
	const tokenPresent = flyApiToken !== undefined && flyApiToken !== "";
	const nodeEnv = process.env.NODE_ENV;
	const isDevByToken = !tokenPresent;
	const isDevByNodeEnv = nodeEnv === "development";

	console.log("[DevMode] Checking dev mode:", {
		tokenPresent,
		tokenLength: flyApiToken?.length ?? 0,
		nodeEnv: nodeEnv ?? "undefined",
		isDevByToken,
		isDevByNodeEnv,
		result: isDevByToken || isDevByNodeEnv,
	});

	// Check if token is missing or empty
	if (isDevByToken) {
		return true;
	}

	// Check if explicitly in development mode
	if (isDevByNodeEnv) {
		return true;
	}

	return false;
};

