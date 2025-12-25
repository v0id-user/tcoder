# Local Development Setup

This guide explains how to run the tcoder system locally for development and testing.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Docker
- Cloudflare account (for Workers, R2, Queues)

## Quick Start

### 1. Create `.env` File

```env
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

# Upstash Redis (for Cloudflare Worker - get from console.upstash.com)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

> **Note:** For local development, the fly-worker uses a local Redis with [Serverless Redis HTTP (SRH)](https://upstash.com/docs/redis/sdks/ts/developing) proxy that emulates the Upstash API. No Upstash credentials needed for fly-worker locally.

### 2. Run Everything

```bash
bun run dev
```

This starts:
- **Redis** - Local Redis container
- **SRH Proxy** - Upstash-compatible HTTP API at `http://localhost:8079`
- **Fly-worker** - Docker container polling Redis for jobs
- **Wrangler dev** - API at `http://localhost:8787`
- **Scheduled trigger** - Hits cron endpoint every 5 minutes

All run together. Press `Ctrl+C` to stop everything.

## Architecture (Local Dev)

```
┌─────────────────────┐
│ Cloudflare Worker   │──── Uses Upstash (production Redis)
│ :8787               │
└─────────────────────┘

┌─────────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Fly-worker          │────▶│ SRH Proxy       │────▶│ Local Redis     │
│ (Docker)            │     │ :8079           │     │ (Docker)        │
└─────────────────────┘     └─────────────────┘     └─────────────────┘
```

**Local credentials (hardcoded in docker-compose):**
- **SRH URL:** `http://localhost:8079`
- **SRH Token:** `local_dev_token`

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start everything (redis + srh + fly-worker + wrangler + trigger) |
| `bun run fly-worker:build` | Build fly-worker Docker image only |
| `bun run fly-worker:run` | Run fly-worker container once |

## Production Setup

For production, both services connect to Upstash:

**Cloudflare Worker** (via wrangler secrets):
```bash
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

**Fly-worker** (via fly secrets):
```bash
fly secrets set UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
fly secrets set UPSTASH_REDIS_REST_TOKEN=your-token
fly secrets set R2_ACCOUNT_ID=...
fly secrets set R2_ACCESS_KEY_ID=...
fly secrets set R2_SECRET_ACCESS_KEY=...
fly secrets set R2_OUTPUT_BUCKET_NAME=...
```

## Troubleshooting

### Fly-worker Can't Connect to Redis

Check that all containers are running:
```bash
docker ps | grep tcoder
```

You should see:
- `tcoder-redis`
- `tcoder-redis-http`
- `tcoder-fly-worker`

### Redis Data Cleanup

To reset local Redis data:
```bash
docker-compose down -v
```

### Test SRH Proxy

```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["PING"]'
```

Should return: `{"result":"PONG"}`

### Scheduled Endpoint Not Triggering

- The trigger runs every 5 minutes after startup
- First trigger happens 5 seconds after `bun run dev` starts
- Check console for `[Trigger]` log messages
