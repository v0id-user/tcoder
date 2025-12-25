/**
 * Mock Fly Machines API for Testing
 *
 * Provides mock implementations of Fly Machines API responses
 * for testing machine pool and spawner functionality.
 */

import type { Machine } from "../../fly/fly-machine-apis";

export interface MockFlyApiConfig {
	machines?: Machine[];
	shouldFailStart?: boolean;
	shouldFailStop?: boolean;
	shouldFailCreate?: boolean;
	shouldFailList?: boolean;
	errorStatus?: number;
	errorBody?: string;
}

export class MockFlyApi {
	private machines: Map<string, Machine> = new Map();
	private shouldFailStart = false;
	private shouldFailStop = false;
	private shouldFailCreate = false;
	private shouldFailList = false;
	private errorStatus = 500;
	private errorBody = "Internal Server Error";

	constructor(config: MockFlyApiConfig = {}) {
		if (config.machines) {
			for (const machine of config.machines) {
				if (machine.id) {
					this.machines.set(machine.id, machine);
				}
			}
		}
		this.shouldFailStart = config.shouldFailStart || false;
		this.shouldFailStop = config.shouldFailStop || false;
		this.shouldFailCreate = config.shouldFailCreate || false;
		this.shouldFailList = config.shouldFailList || false;
		this.errorStatus = config.errorStatus || 500;
		this.errorBody = config.errorBody || "Internal Server Error";
	}

	async listMachines(): Promise<Machine[]> {
		if (this.shouldFailList) {
			throw this.createError(this.errorStatus, this.errorBody);
		}
		return Array.from(this.machines.values());
	}

	async startMachine(machineId: string): Promise<void> {
		if (this.shouldFailStart) {
			throw this.createError(this.errorStatus, this.errorBody);
		}
		const machine = this.machines.get(machineId);
		if (!machine) {
			throw this.createError(404, "Machine not found");
		}
		this.machines.set(machineId, { ...machine, state: "started" });
	}

	async stopMachine(machineId: string): Promise<void> {
		if (this.shouldFailStop) {
			throw this.createError(this.errorStatus, this.errorBody);
		}
		const machine = this.machines.get(machineId);
		if (!machine) {
			throw this.createError(404, "Machine not found");
		}
		this.machines.set(machineId, { ...machine, state: "stopped" });
	}

	async createMachine(machineRequest: unknown): Promise<Machine> {
		if (this.shouldFailCreate) {
			throw this.createError(this.errorStatus, this.errorBody);
		}
		const machineId = `mock-machine-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const machine: Machine = {
			id: machineId,
			name: (machineRequest as { name?: string }).name || `machine-${machineId}`,
			state: "started",
			region: (machineRequest as { region?: string }).region || "iad",
			created_at: new Date().toISOString(),
		};
		this.machines.set(machineId, machine);
		return machine;
	}

	getMachine(machineId: string): Machine | undefined {
		return this.machines.get(machineId);
	}

	addMachine(machine: Machine): void {
		if (machine.id) {
			this.machines.set(machine.id, machine);
		}
	}

	removeMachine(machineId: string): void {
		this.machines.delete(machineId);
	}

	reset(config: MockFlyApiConfig = {}): void {
		this.machines.clear();
		if (config.machines) {
			for (const machine of config.machines) {
				if (machine.id) {
					this.machines.set(machine.id, machine);
				}
			}
		}
		this.shouldFailStart = config.shouldFailStart || false;
		this.shouldFailStop = config.shouldFailStop || false;
		this.shouldFailCreate = config.shouldFailCreate || false;
		this.shouldFailList = config.shouldFailList || false;
		this.errorStatus = config.errorStatus || 500;
		this.errorBody = config.errorBody || "Internal Server Error";
	}

	private createError(status: number, body: string): Error {
		const error = new Error(body) as Error & { response?: { status: number; data: string } };
		error.response = { status, data: body };
		return error;
	}
}

/**
 * Helper to create a mock Machine
 */
export function createMockMachine(overrides?: Partial<Machine>): Machine {
	const now = Date.now();
	return {
		id: `mock-machine-${now}`,
		name: `machine-${now}`,
		state: "started",
		region: "iad",
		created_at: new Date().toISOString(),
		...overrides,
	};
}
