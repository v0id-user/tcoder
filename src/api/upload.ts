import { zValidator } from "@hono/zod-validator";
import { Redis } from "@upstash/redis/cloudflare";
import { Effect } from "effect";
import { Hono } from "hono";
import { makeLoggerLayer, makeEffectLoggerLayer, LoggerService } from "../../packages/logger";
import { createR2Client, generateInputKey, generateUploadUrl } from "../r2/presigned";
import { type JobData, RWOS_CONFIG, RedisKeys, serializeJobData } from "../redis/schema";
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
		const startTime = Date.now();
		const requestId = crypto.randomUUID();
		const loggerLayer = makeLoggerLayer({ component: "Upload", logLevel: "info" });
		const effectLoggerLayer = makeEffectLoggerLayer("info");

		const body = c.req.valid("json");

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("POST /upload - Request received", {
					requestId,
					method: "POST",
					path: "/upload",
					filename: body.filename,
					contentType: body.contentType,
					preset: body.preset,
					outputQualities: body.outputQualities,
					userAgent: c.req.header("user-agent"),
					ip: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for"),
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		const jobId = crypto.randomUUID();

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Generated job ID", {
					requestId,
					jobId,
					event: "job.created",
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		const r2Config = {
			accountId: c.env.R2_ACCOUNT_ID,
			accessKeyId: c.env.R2_ACCESS_KEY_ID,
			secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
			bucketName: c.env.R2_INPUT_BUCKET_NAME,
		};

		const r2Client = createR2Client(r2Config);
		const inputKey = generateInputKey(jobId, body.filename);

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Generating presigned URL", {
					requestId,
					jobId,
					inputKey,
					bucketName: r2Config.bucketName,
					expiresIn: RWOS_CONFIG.PRESIGNED_URL_EXPIRY_SECONDS,
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

		const presigned = await generateUploadUrl(r2Client, r2Config.bucketName, inputKey, {
			expiresIn: RWOS_CONFIG.PRESIGNED_URL_EXPIRY_SECONDS,
			contentType: body.contentType,
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const logger = yield* LoggerService;
				yield* logger.info("Presigned URL generated", {
					requestId,
					jobId,
					inputKey,
					expiresAt: presigned.expiresAt,
					event: "presigned.url.created",
				});
			}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
		);

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

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Storing job in Redis", {
						requestId,
						jobId,
						status: jobData.status,
						ttl: RWOS_CONFIG.JOB_STATUS_TTL_SECONDS,
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			await redis.hset(RedisKeys.jobStatus(jobId), serializeJobData(jobData));
			await redis.expire(RedisKeys.jobStatus(jobId), RWOS_CONFIG.JOB_STATUS_TTL_SECONDS);

			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("Job stored in Redis successfully", {
						requestId,
						jobId,
						event: "job.stored",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			const duration = Date.now() - startTime;
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.info("POST /upload - Request completed", {
						requestId,
						jobId,
						statusCode: 201,
						durationMs: duration,
						event: "request.completed",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);

			return c.json(
				{
					jobId,
					uploadUrl: presigned.uploadUrl,
					expiresAt: presigned.expiresAt,
					inputKey,
				},
				201,
			);
		} catch (error) {
			const duration = Date.now() - startTime;
			await Effect.runPromise(
				Effect.gen(function* () {
					const logger = yield* LoggerService;
					yield* logger.error("POST /upload - Redis error", error, {
						requestId,
						jobId,
						statusCode: 500,
						durationMs: duration,
						event: "request.failed",
						errorType: "redis_error",
					});
				}).pipe(Effect.provide(loggerLayer), Effect.provide(effectLoggerLayer)),
			);
			return c.json({ error: "Redis connection failed" }, 500);
		}
	});

	return app;
};

export const createUploadRoutes = (): ReturnType<typeof buildUploadRoutes> => {
	return buildUploadRoutes();
};
