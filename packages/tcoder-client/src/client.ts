/**
 * RPC Client Setup
 *
 * Creates a type-safe Hono RPC client using AppType from the main package.
 */

import { hc } from "hono/client";
import type { AppType } from "../../../src/api/client-types";

/**
 * Pre-compiled client type for better IDE performance.
 */
export type Client = ReturnType<typeof hc<AppType>>;

/**
 * Create a type-safe Hono RPC client.
 *
 * @param baseUrl - Base URL of the API server (e.g., "http://localhost:8787" or "/api")
 * @param options - Optional client configuration (headers, credentials, etc.)
 * @returns Typed RPC client
 */
export const createClient = (baseUrl: string, options?: Parameters<typeof hc<AppType>>[1]): Client => {
	return hc<AppType>(baseUrl, options);
};
