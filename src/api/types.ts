import type { RedisEnv } from "../redis/client";

export type Env = RedisEnv & {
	// R2 bindings
	INPUT_BUCKET: R2Bucket;
	OUTPUT_BUCKET: R2Bucket;
	// R2 credentials for presigned URLs
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_INPUT_BUCKET_NAME: string;
	R2_OUTPUT_BUCKET_NAME: string;
	// Fly config
	FLY_API_TOKEN: string;
	FLY_APP_NAME: string;
	FLY_REGION: string;
	WEBHOOK_BASE_URL: string;
};

