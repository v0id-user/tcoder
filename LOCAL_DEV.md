# Local Development Setup

This guide explains how to run the tcoder system locally for development and testing.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Docker
- Cloudflare account (for Workers, R2, Queues)
- Upstash account (for Redis - free tier works fine)

## Quick Start

### 1. Set Up Hosted Services

**Upstash Redis (free tier):**
1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database
3. Copy the REST URL and REST Token

**Cloudflare R2:**
- Create R2 API token at https://dash.cloudflare.com → R2 → Manage R2 API Tokens

### 2. Create `.env` File

Create a `.env` file in the root directory (used by both wrangler and fly-worker):

```env
# Redis (direct connection for fly-worker)
REDIS_URL=redis://user:password@your-redis-host:6379

# Upstash Redis (HTTP API for Cloudflare Worker)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Fly.io
FLY_API_TOKEN=your-fly-token
FLY_APP_NAME=your-fly-app-name
FLY_REGION=fra

# R2 Configuration
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_INPUT_BUCKET_NAME=tcoder-input
R2_OUTPUT_BUCKET_NAME=tcoder-output
```

### 3. Run Everything

```bash
bun run dev
```

This starts:
- **Fly-worker** - Docker container polling Redis for jobs
- **Wrangler dev** - API at `http://localhost:8787`
- **Scheduled trigger** - Hits cron endpoint every 5 minutes

All three run together. Press `Ctrl+C` to stop everything.

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

### Fly-worker Missing Environment Variables

The fly-worker requires these env vars in `.env`:
- `REDIS_URL` (direct Redis connection, e.g. `redis://user:pass@host:6379`)
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_OUTPUT_BUCKET_NAME`

If any are missing, the worker will exit with an error listing which ones are missing.

### Worker Can't Connect to Redis

- Verify your Upstash credentials in `.env`
- Check that the REST URL starts with `https://`

### Scheduled Endpoint Not Triggering

- The trigger runs every 5 minutes after startup
- First trigger happens 5 seconds after `bun run dev` starts
- Check console for `[Trigger]` log messages
