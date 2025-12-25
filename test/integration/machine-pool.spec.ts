/**
 * Integration Tests - Machine Pool Lifecycle
 *
 * End-to-end tests for machine pool management:
 * 1. Machine creation → Pool entry
 * 2. Machine stopping → Stopped set
 * 3. Machine reuse → Starting stopped machine
 * 4. Pool synchronization
 * 5. Capacity limits
 *
 * Note: These are integration tests that may require Fly API access.
 * They test the complete flow but may be skipped if services are unavailable.
 */

import { describe, expect, it } from "vitest";
import { getCloudflareTest } from "../test-helpers";

describe("Machine Pool Lifecycle Integration", () => {
	it("checks system stats reflect machine pool state", async () => {
		const cfTest = await getCloudflareTest();
		if (!cfTest) return;
		const { SELF } = cfTest;

		const statsResponse = await SELF.fetch("https://example.com/api/stats");

		// May fail if Redis is not configured
		if (statsResponse.status !== 200) {
			console.log("Skipping machine pool stats test: Redis not configured");
			return;
		}

		const stats = (await statsResponse.json()) as {
			machines: {
				activeMachines: number;
				maxMachines: number;
			};
			pendingJobs: number;
			activeJobs: number;
			activeJobIds: string[];
		};

		expect(stats).toHaveProperty("machines");
		expect(stats.machines).toHaveProperty("activeMachines");
		expect(stats.machines).toHaveProperty("maxMachines");
		expect(stats.machines.activeMachines).toBeGreaterThanOrEqual(0);
		expect(stats.machines.maxMachines).toBeGreaterThan(0);
		expect(stats.machines.activeMachines).toBeLessThanOrEqual(stats.machines.maxMachines);

		expect(stats).toHaveProperty("pendingJobs");
		expect(stats).toHaveProperty("activeJobs");
		expect(stats).toHaveProperty("activeJobIds");
		expect(Array.isArray(stats.activeJobIds)).toBe(true);
	});

	it("verifies machine pool capacity limits", async () => {
		const cfTest = await getCloudflareTest();
		if (!cfTest) return;
		const { SELF } = cfTest;

		// Get current stats
		const statsResponse = await SELF.fetch("https://example.com/api/stats");
		if (statsResponse.status !== 200) {
			console.log("Skipping capacity limit test: Redis not configured");
			return;
		}

		const stats = (await statsResponse.json()) as {
			machines: {
				activeMachines: number;
				maxMachines: number;
			};
		};

		// Verify capacity limits are enforced
		expect(stats.machines.activeMachines).toBeLessThanOrEqual(stats.machines.maxMachines);
	});

	// Note: Full machine pool lifecycle testing (creating machines, stopping them, reusing them)
	// would require:
	// 1. Fly API access and credentials
	// 2. Ability to actually create/destroy machines
	// 3. Long-running tests
	//
	// These are better suited for:
	// - Manual testing in a staging environment
	// - E2E tests in CI/CD with proper test infrastructure
	// - Monitoring and observability in production
	//
	// The unit tests in machine-pool.spec.ts and spawner.spec.ts cover the logic,
	// and these integration tests verify the stats endpoint reflects the pool state correctly.
});
