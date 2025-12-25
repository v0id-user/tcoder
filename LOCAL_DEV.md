# Local Development Setup

This guide explains how to run the tcoder system locally for development and testing.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Docker (only needed for fly-worker testing)
- Cloudflare account (for Workers, R2, Queues)
- Upstash account (for Redis - free tier works fine)

## Quick Start

### 1. Set Up Hosted Services

**Upstash Redis (free tier):**
1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database
3. Copy the REST URL and REST Token

**Cloudflare R2 & Queues:**
- R2 buckets are configured in `wrangler.jsonc`
- Queues are configured in `wrangler.jsonc`

### 2. Create `.dev.vars` File

Create a `.dev.vars` file in the root directory. Wrangler automatically loads this for local dev:

```env
# Upstash Redis (required)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Fly.io (required for spawning workers)
FLY_API_TOKEN=your-fly-token
FLY_APP_NAME=your-fly-app-name
FLY_REGION=fra

# Webhook URL (for job completion callbacks)
WEBHOOK_BASE_URL=http://localhost:8787

# R2 credentials (for presigned URLs)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_INPUT_BUCKET_NAME=tcoder-input
R2_OUTPUT_BUCKET_NAME=tcoder-output
```

### 3. Create `.env` File

Create a `.env` file for the fly-worker container:

```env
# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# R2 Configuration (for downloading/uploading files)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=tcoder-output
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

### 4. Run Everything

```bash
bun run dev
```

This starts:
- **Fly-worker** - Docker container polling Redis for jobs
- **Wrangler dev** - API at `http://localhost:8787`
- **Scheduled trigger** - Hits cron endpoint every 5 minutes

All three run together. Press `Ctrl+C` to stop everything.

## Environment Files

| File | Purpose | Used By |
|------|---------|---------|
| `.dev.vars` | Wrangler local dev secrets | `wrangler dev` |
| `.env` | Fly-worker container env vars | `docker-compose` |

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start everything (fly-worker + wrangler + trigger) |
| `bun run fly-worker:build` | Build fly-worker Docker image only |
| `bun run fly-worker:run` | Run fly-worker container once |

## Architecture Notes

- **Cloudflare Worker**: Handles API, R2 events, job orchestration
- **Upstash Redis**: Job queue, worker leases, state management
- **Fly-worker**: One-shot FFmpeg container spawned on demand

All services use hosted/managed infrastructure. No local databases or custom proxies needed.

## Troubleshooting

### Worker Can't Connect to Redis

- Verify your Upstash credentials in `.dev.vars`
- Check that the REST URL starts with `https://`

### Scheduled Endpoint Not Triggering

- The trigger runs every 5 minutes after startup
- First trigger happens 5 seconds after `bun run dev` starts
- Check console for `[Trigger]` log messages

### Fly-worker Can't Download from R2

- Verify R2 credentials in `.env`
- Ensure the bucket name matches
- Check that R2 API token has read/write permissions
