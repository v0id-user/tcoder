import { z } from "zod";

export const uploadRequestSchema = z.object({
	filename: z.string().min(1),
	contentType: z.string().optional().default("video/mp4"),
	preset: z.enum(["default", "web-optimized", "hls", "hls-adaptive"]).default("default"),
	outputQualities: z.array(z.string()).optional(),
});

export const submitJobSchema = z.object({
	jobId: z.string().uuid().optional(),
	inputUrl: z.string().url(),
	outputUrl: z.string(),
	preset: z.enum(["default", "web-optimized", "hls", "hls-adaptive"]).default("default"),
	outputQualities: z.array(z.string()).optional(),
	r2Config: z
		.object({
			accountId: z.string(),
			accessKeyId: z.string(),
			secretAccessKey: z.string(),
			bucketName: z.string(),
			endpoint: z.string().optional(),
		})
		.optional(),
});

export const webhookPayloadSchema = z.object({
	jobId: z.string(),
	status: z.enum(["completed", "failed"]),
	inputUrl: z.string(),
	outputs: z.array(
		z.object({
			quality: z.string(),
			url: z.string(),
			preset: z.string(),
		}),
	),
	error: z.string().optional(),
	duration: z.number().optional(),
});
