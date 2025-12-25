# Local Development Setup

This guide explains how to run the tcoder system locally for development and testing.

## Prerequisites

- Docker and Docker Compose
- Bun runtime
- Cloudflare account (for R2 and Workers)

## Quick Start

### 1. Start Everything

```bash
bun run dev
```

This will:
- Start Redis and Redis REST API proxy via Docker Compose
- Start Cloudflare Worker with `wrangler dev`
- Start a concurrent job that triggers the scheduled endpoint every 5 minutes

### 2. Run Services Separately

**Start only Docker services:**
```bash
bun run dev:docker
```

**Start only Cloudflare Worker:**
```bash
bun run dev:cf
```

**Build Docker image for Fly worker:**
```bash
bun run docker:build
```

**Start Docker services in background:**
```bash
bun run docker:up
```

**Stop Docker services:**
```bash
bun run docker:down
```

## Architecture

### Docker Compose Services

- **redis**: Standard Redis instance on port 6379
- **redis-rest-api**: REST API proxy for Redis (port 8080) - allows `@upstash/redis` to connect
- **fly-worker**: Fly worker container (built from `fly/Dockerfile`) - started manually via profile

### Local Redis Connection

The Fly worker connects to Redis via REST API at `http://redis-rest-api:8080` when running in Docker, or `http://localhost:8080` when running locally.

### Scheduled Endpoint Trigger

The `scripts/trigger-scheduled.ts` script automatically hits the Cloudflare Worker's scheduled endpoint every 5 minutes to simulate cron triggers during local development.

The endpoint URL is: `http://127.0.0.1:8787/cdn-cgi/handler/scheduled`

## Environment Variables

Create a `.env` file in the root directory with:

```env
# Redis (for local Docker Compose)
UPSTASH_REDIS_REST_URL=http://localhost:8080
UPSTASH_REDIS_REST_TOKEN=

# R2 Configuration (for Fly worker)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket-name
R2_ENDPOINT=

# Webhook URL (for Fly worker to notify Cloudflare worker)
WEBHOOK_URL=http://host.docker.internal:8787/webhooks/job-complete

# Cloudflare Worker Port (default: 8787)
PORT=8787
```

## Testing the Fly Worker Locally

To test the Fly worker container:

1. Build the image:
   ```bash
   bun run docker:build
   ```

2. Run the container with the worker profile:
   ```bash
   docker-compose --profile worker up fly-worker
   ```

3. Or run it directly:
   ```bash
   docker run --rm \
     --env-file .env \
     -e UPSTASH_REDIS_REST_URL=http://host.docker.internal:8080 \
     tcoder-fly-worker
   ```

## Troubleshooting

### Redis Connection Issues

If the worker can't connect to Redis:
- Ensure Redis REST API is running: `docker-compose ps`
- Check Redis REST API logs: `docker-compose logs redis-rest-api`
- Verify the URL is correct: `http://localhost:8080` (local) or `http://redis-rest-api:8080` (Docker)

### Scheduled Endpoint Not Triggering

- Check that `scripts/trigger-scheduled.ts` is running (should see logs)
- Verify wrangler is running on port 8787
- Check the trigger script logs for errors

### Port Conflicts

If port 8787 is already in use:
- Set `PORT` environment variable to a different port
- Update the trigger script's `PORT` constant if needed

## Notes

- The Redis REST API proxy (`redis-http-api`) provides a REST interface to standard Redis, allowing `@upstash/redis` to work with local Redis
- The Fly worker container is not started automatically - use the `worker` profile to start it
- All scripts use Effect patterns for proper error handling and cleanup

