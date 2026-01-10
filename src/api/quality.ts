/**
 * Video Quality Types
 *
 * Supported video quality levels for transcoding outputs.
 * These values represent standard video resolution formats.
 */

export type VideoQuality = "480p" | "720p" | "1080p";

/**
 * Array of all supported video quality values.
 * Useful for validation and iteration.
 */
export const VIDEO_QUALITIES: readonly VideoQuality[] = ["480p", "720p", "1080p"] as const;
