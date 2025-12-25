# Local Development Setup

This guide explains how to run the tcoder system locally for development and testing.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Docker
- Cloudflare account (for Workers, R2, Queues)
- Upstash account (for Redis HTTP API - free tier works)

## Quick Start

### 1. Set Up Upstash Redis

Go to [console.upstash.com](https://console.upstash.com) and create a Redis database.

The Cloudflare Worker needs the **REST API** credentials from Upstash.

### 2. Create `.env` File

```env
# Upstash Redis - REST API (for Cloudflare Worker)
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

> **Note:** The fly-worker uses a **local Redis** container (no config needed). The Cloudflare Worker uses Upstash REST API.

### 3. Run Everything

```bash
bun run dev
```

This starts:
- **Local Redis** - `localhost:6379` (no password)
- **Fly-worker** - Docker container polling local Redis
- **Wrangler dev** - API at `http://localhost:8787`
- **Scheduled trigger** - Hits cron endpoint every 5 minutes

All run together. Press `Ctrl+C` to stop everything.

## Local Redis

For local development, we run Redis in Docker:
- **URL:** `redis://localhost:6379`
- **No password** required
- Data persisted in Docker volume `redis-data`

The fly-worker automatically connects to this local Redis (hardcoded in docker-compose).

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start everything (redis + fly-worker + wrangler + trigger) |
| `bun run fly-worker:build` | Build fly-worker Docker image only |
| `bun run fly-worker:run` | Run fly-worker container once |

## Architecture (Local Dev)

```
┌─────────────────┐     ┌─────────────────┐
│ Cloudflare      │     │ Local Redis     │
│ Worker (API)    │────▶│ localhost:6379  │◀────┐
│ :8787           │     └─────────────────┘     │
└─────────────────┘                              │
                                                 │
                       ┌─────────────────┐       │
                       │ Fly-worker      │───────┘
                       │ (Docker)        │
                       └─────────────────┘
```

**Note:** In local dev, the Cloudflare Worker uses Upstash REST API while the fly-worker uses local Redis. For full integration testing, both should point to the same Redis (use Upstash for both, see Production Setup).

## Production Setup

For production, both services connect to Upstash:
- **Cloudflare Worker:** `UPSTASH_REDIS_REST_URL` (HTTP API)
- **Fly-worker:** `REDIS_URL` (direct TCP via ioredis)

Get the direct TCP URL from Upstash Console → Connect → ioredis:
```
rediss://default:password@your-redis.upstash.io:6379
```

## Troubleshooting

### Fly-worker Can't Connect to Redis

Check that the Redis container is running:
```bash
docker ps | grep tcoder-redis
```

### Redis Data Cleanup

To reset local Redis data:
```bash
docker-compose down -v
```

### Cloudflare Worker Can't Connect to Upstash

- Verify credentials in `.env`
- REST URL should start with `https://`
- Check the Upstash console for correct values

### Scheduled Endpoint Not Triggering

- The trigger runs every 5 minutes after startup
- First trigger happens 5 seconds after `bun run dev` starts
- Check console for `[Trigger]` log messages
