import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Hono } from "hono";
import { createR2Client, generateInputKey, generateUploadUrl } from "../r2/presigned";
import { RWOS_CONFIG, RedisKeys, serializeJobData, type JobData } from "../redis/schema";
import { uploadRequestSchema } from "./schemas";
import type { Env } from "./types";

const buildUploadRoutes = () => {
	/**
	 * POST /upload - Request a presigned URL for uploading
	 *
	 * 1. Generate job ID
	 * 2. Create presigned PUT URL for R2
	 * 3. Store job with "uploading" status in Redis
	 * 4. Return upload URL and job ID to client
	 */
	const app = new Hono<{ Bindings: Env }>().post("/upload", zValidator("json", uploadRequestSchema), async (c) => {
		const body = c.req.valid("json");
		const jobId = crypto.randomUUID();

		const r2Config = {
			accountId: c.env.R2_ACCOUNT_ID,
			accessKeyId: c.env.R2_ACCESS_KEY_ID,
			secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
			bucketName: c.env.R2_INPUT_BUCKET_NAME,
		};

		const r2Client = createR2Client(r2Config);
		const inputKey = generateInputKey(jobId, body.filename);

		const presigned = await generateUploadUrl(r2Client, r2Config.bucketName, inputKey, {
			expiresIn: RWOS_CONFIG.PRESIGNED_URL_EXPIRY_SECONDS,
			contentType: body.contentType,
		});

		try {
			const redis = Redis.fromEnv(c.env);

			const jobData: JobData = {
				jobId,
				status: "uploading",
				inputKey,
				outputUrl: `outputs/${jobId}`,
				preset: body.preset,
				webhookUrl: `${c.env.WEBHOOK_BASE_URL}/webhooks/job-complete`,
				outputQualities: body.outputQualities,
				filename: body.filename,
				contentType: body.contentType,
				timestamps: {
					createdAt: Date.now(),
				},
				retries: 0,
			};

			await redis.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
			await redis.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);
		} catch (error) {
			console.error("[Route] Redis error in /upload:", error);
			return c.json({ error: "Redis connection failed" }, 500);
		}

		return c.json(
			{
				jobId,
				uploadUrl: presigned.uploadUrl,
				expiresAt: presigned.expiresAt,
				inputKey,
			},
			201,
		);
	});

	return app;
};

export const createUploadRoutes = (): ReturnType<typeof buildUploadRoutes> => {
	return buildUploadRoutes();
};
