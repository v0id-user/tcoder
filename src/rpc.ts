/**
 * RPC Client for Hono API
 *
 * Provides type-safe client access to the Hono API routes.
 * Uses pre-compiled types for better IDE performance.
 *
 * @see https://hono.dev/docs/guides/rpc
 */

import { hc } from "hono/client";
import type { AppType } from "./index";

// Pre-compile the client type at build time for better IDE performance
// This avoids expensive type instantiation during development
// @see https://hono.dev/docs/guides/rpc#ide-performance
export type Client = ReturnType<typeof hc<AppType>>;

/**
 * Create a type-safe Hono RPC client.
 *
 * @param baseUrl - Base URL of the API server (e.g., "http://localhost:8787" or "/api")
 * @param options - Optional client configuration (headers, credentials, etc.)
 * @returns Typed RPC client
 *
 * @example
 * ```ts
 * const client = createClient("http://localhost:8787");
 * const res = await client.api.jobs.$get({ query: { id: "123" } });
 * ```
 */
export const createClient = (
	baseUrl: string,
	options?: Parameters<typeof hc<AppType>>[1],
): Client => {
	return hc<AppType>(baseUrl, options);
};

/**
 * Pre-compiled client factory for better IDE performance.
 * Use this instead of calling `createClient` directly if you want to avoid
 * type instantiation overhead during development.
 *
 * @example
 * ```ts
 * const client = hcWithType("http://localhost:8787");
 * ```
 */
export const hcWithType = (...args: Parameters<typeof hc<AppType>>): Client =>
	hc<AppType>(...args);

/**
 * Default RPC client instance.
 * Uses "/" as base URL for same-origin requests.
 * For custom base URLs, use `createClient()` instead.
 *
 * @example
 * ```ts
 * import { client } from "./rpc";
 * const res = await client.api.jobs.$get({ query: { id: "123" } });
 * ```
 */
export const client = hcWithType("/");

