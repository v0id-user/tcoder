/**
 * Video Quality Types
 *
 * Supported video quality levels for transcoding outputs.
 * These values represent standard video resolution formats.
 */

export type VideoQuality = "144p" | "360p" | "720p";

/**
 * Array of all supported video quality values.
 * Useful for validation and iteration.
 */
export const VIDEO_QUALITIES: readonly VideoQuality[] = ["144p", "360p", "720p"] as const;
