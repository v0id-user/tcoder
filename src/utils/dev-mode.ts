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
	// Check if token is missing or empty
	if (flyApiToken === undefined || flyApiToken === "") {
		return true;
	}

	// Check if explicitly in development mode
	if (process.env.NODE_ENV === "development") {
		return true;
	}

	return false;
};

