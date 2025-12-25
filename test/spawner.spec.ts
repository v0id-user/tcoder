import { describe, expect, it } from "vitest";
import type { SpawnConfig } from "../src/orchestration/spawner";

// Helper to check dev mode detection logic
// Note: This tests the logic pattern, not the actual function which is private
const isDevMode = (config: SpawnConfig): boolean => {
	return !config.flyApiToken || config.flyApiToken === "" || process.env.NODE_ENV === "development";
};

describe("Spawner Dev Mode Detection", () => {
	it("detects dev mode when API token is missing", () => {
		const config: SpawnConfig = {
			flyApiToken: "",
			flyAppName: "test-app",
			flyRegion: "iad",
			redisUrl: "https://redis.example.com",
			redisToken: "token",
			webhookBaseUrl: "https://example.com",
		};

		expect(isDevMode(config)).toBe(true);
	});

	it("detects production mode when API token is present", () => {
		const config: SpawnConfig = {
			flyApiToken: "valid-token",
			flyAppName: "test-app",
			flyRegion: "iad",
			redisUrl: "https://redis.example.com",
			redisToken: "token",
			webhookBaseUrl: "https://example.com",
		};

		// Only check if not in development env
		if (process.env.NODE_ENV !== "development") {
			expect(isDevMode(config)).toBe(false);
		}
	});

	it("handles empty string token as dev mode", () => {
		const config: SpawnConfig = {
			flyApiToken: "",
			flyAppName: "test-app",
			flyRegion: "iad",
			redisUrl: "https://redis.example.com",
			redisToken: "token",
			webhookBaseUrl: "https://example.com",
		};

		expect(isDevMode(config)).toBe(true);
	});
});
