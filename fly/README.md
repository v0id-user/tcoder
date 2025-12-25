# Fly.io FFmpeg Workers with Redis Orchestration (RWOS)

TTL-bounded FFmpeg workers orchestrated via Redis. Each worker processes multiple jobs before exiting, minimizing Fly API calls and costs.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How It Works](#how-it-works)
- [Key Differences from Ephemeral Model](#key-differences-from-ephemeral-model)
- [RWOS Components](#rwos-components)
- [Worker Lifecycle](#worker-lifecycle)
- [Admission Control](#admission-control)
- [Redis Data Model](#redis-data-model)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Cost Analysis](#cost-analysis)
- [Monitoring](#monitoring)
- [Debugging](#debugging)
- [Security](#security)

## Architecture Overview

![Redis Worker Orchestration System](../design/architecture/RWOS/Redis%20Worker%20Orchestration%20System.png)

The system uses a **control plane / worker plane** split:

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Control Plane** | Cloudflare Worker | Job submission, admission control, machine spawning |
| **State Store** | Upstash Redis | Job queue, worker leases, concurrency counters |
| **Compute Plane** | Fly Machines | FFmpeg processing, R2 I/O, webhook notifications |

## How It Works

1. **Job Submission**: Client submits job → Cloudflare Worker enqueues to Redis
2. **Admission Control**: Check rate limit (1 req/sec) + capacity (max 5 machines)
3. **Worker Spawn**: If capacity available, create Fly Machine via API
4. **Job Processing**: Worker acquires lease, pops jobs from queue, processes
5. **Multi-Job Loop**: Worker processes 1-3 jobs until TTL (5 min) or max jobs
6. **Graceful Exit**: Worker releases lease, decrements counter, exits
7. **Failure Recovery**: Cron job detects dead workers, requeues stale jobs

```
Job Submitted → Redis Queue → Worker Pops → FFmpeg → R2 Upload → Webhook → Next Job or Exit
                    ↑                                                              ↓
              Cron requeues                                              Lease released
              stale jobs                                                 Counter decremented
```

## Key Differences from Ephemeral Model

| Aspect | Old (Ephemeral) | New (RWOS) |
|--------|-----------------|------------|
| Jobs per machine | 1 | 1-3 (configurable) |
| Machine lifetime | Job duration | TTL-bounded (5 min) |
| Job discovery | Env vars at creation | Redis queue polling |
| State management | None | Redis leases + counters |
| Failure handling | None | Automatic requeue |
| API calls | 1 per job | 1 per 3 jobs |
| Observability | Fly logs only | Redis + logs |

## RWOS Components

### Control Plane (Cloudflare Worker)

- **Hono API**: Job submission endpoints (`POST /api/jobs`)
- **Admission Controller**: Rate limiting + capacity enforcement
- **Machine Spawner**: Fly API calls with exponential backoff
- **Cron Handler**: Stale job recovery (every minute)

### State Store (Upstash Redis)

| Key | Type | Purpose |
|-----|------|---------|
| `jobs:pending` | ZSET | Job queue sorted by timestamp |
| `jobs:active` | HASH | job_id → machine_id mapping |
| `jobs:status:{id}` | HASH | Job metadata and status |
| `workers:leases` | HASH | machine_id → expiry timestamp |
| `counters:active_machines` | STRING | Current machine count |
| `counters:rate_limit` | STRING | API rate limit (1s TTL) |

### Compute Plane (Fly Machine)

- **Redis Client**: Polls job queue, updates status
- **Lease Manager**: Acquires/extends/releases leases
- **FFmpeg Pipeline**: Download → transcode → upload
- **Webhook Client**: Notifies control plane on completion

## Worker Lifecycle

![Worker Lifecycle](../design/architecture/RWOS/Worker%20Lifecycle.png)

**States:**
1. **Starting**: Machine boots, connects to Redis
2. **Active**: Polling queue for jobs
3. **Processing**: Running FFmpeg pipeline
4. **Draining**: TTL near or max jobs reached
5. **Exiting**: Cleanup and exit

**Transitions:**
- Active → Processing: Job popped from queue
- Processing → Active: Job completed
- Active → Draining: TTL < 60s OR jobs ≥ 3
- Draining → Exiting: Current job done
- Active → Exiting: No jobs + TTL expired

## Admission Control

![Admission Control Flow](../design/architecture/RWOS/Admission%20Control%20Flow.png)

**Rate Limiting:**
```
INCR counters:rate_limit (TTL 1s)
if count > 1: wait 1s, retry
```

**Capacity Check:**
```
GET counters:active_machines
if count >= 5: job stays queued
else: INCR counter, create machine
```

**Backoff on Fly API errors:**
- 429 (rate limit): exponential backoff
- 5xx: retry with backoff
- Max 5 retries

## Redis Data Model

### Job Status Hash
```
jobs:status:{job_id}
├── jobId: string
├── status: pending | running | completed | failed
├── machineId: string (when running)
├── inputUrl: string
├── outputUrl: string
├── preset: string
├── webhookUrl: string
├── queuedAt: timestamp
├── startedAt: timestamp
├── completedAt: timestamp
├── error: string (if failed)
└── retries: number
```

### Worker Lease
```
workers:leases
├── {machine_id}: expiry_timestamp
└── ...
```

## Deployment

### 1. Set Fly Secrets

```bash
cd fly

fly secrets set \
  REDIS_URL="redis://user:password@your-redis-host:6379" \
  R2_ACCOUNT_ID="your-account-id" \
  R2_ACCESS_KEY_ID="your-access-key" \
  R2_SECRET_ACCESS_KEY="your-secret-key" \
  R2_OUTPUT_BUCKET_NAME="tcoder-output"
```

### 2. Deploy Image

```bash
bun run deploy
```

### 3. Set Cloudflare Worker Secrets

```bash
cd ..

wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put FLY_API_TOKEN
wrangler secret put FLY_APP_NAME      # fly-tcoder-ffmpeg-worker-31657fa
wrangler secret put FLY_REGION        # fra
wrangler secret put WEBHOOK_BASE_URL  # https://your-worker.workers.dev
```

### 4. Deploy Worker

```bash
bun run deploy
```

## Environment Variables

### Fly Machine (set via fly secrets)

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis connection URL (redis://user:pass@host:port) |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_OUTPUT_BUCKET_NAME` | R2 output bucket name |

### Cloudflare Worker (set via wrangler secret)

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Redis REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |
| `FLY_API_TOKEN` | Fly.io API token |
| `FLY_APP_NAME` | Fly app name |
| `FLY_REGION` | Fly region (e.g., fra) |
| `WEBHOOK_BASE_URL` | Worker base URL for webhooks |

## Cost Analysis

**RWOS reduces costs by processing multiple jobs per machine:**

| Metric | Ephemeral (1 job/machine) | RWOS (3 jobs/machine) |
|--------|---------------------------|------------------------|
| Machine creates/day | 100 | 34 |
| Fly API calls/day | 100 | 34 |
| Startup overhead | 100× | 34× |
| Effective cost | 100% | ~70% |

**Pricing (512MB shared CPU):**
- ~$0.0004/second
- ~$0.024/minute
- 5 min TTL = ~$0.12/machine
- 3 jobs/machine = ~$0.04/job

**Budget targets:**
- $5/month ≈ 125 jobs (at 3/machine, 5 min TTL)
- $10/month ≈ 250 jobs

## Monitoring

### Check System Stats
```bash
curl https://your-worker.workers.dev/api/stats
```

Response:
```json
{
  "machines": { "activeMachines": 2, "maxMachines": 5 },
  "pendingJobs": 5,
  "activeJobs": 2,
  "activeJobIds": ["job-123", "job-456"]
}
```

### Check Job Status
```bash
curl https://your-worker.workers.dev/api/jobs/{job_id}
```

### View Fly Logs
```bash
fly logs --app fly-tcoder-ffmpeg-worker-31657fa
```

### List Machines
```bash
fly machines list
```

## Debugging

### Job Stuck in "pending"
1. Check if workers exist: `fly machines list`
2. Check capacity: `GET /api/stats`
3. Check Redis queue: verify `jobs:pending` has entries
4. Check for rate limiting in logs

### Job Stuck in "running"
1. Check worker logs: `fly logs`
2. Check lease expiry in Redis
3. Wait for cron to requeue (1 min interval)

### Worker Not Processing
1. Verify Redis credentials: check `fly secrets list`
2. Check worker startup logs
3. Verify job queue has entries

### Force Cleanup
```bash
# Destroy all machines
fly machines list --json | jq -r '.[].id' | xargs -I {} fly machine destroy {} --force

# Reset Redis counters (via redis-cli or Upstash console)
SET counters:active_machines 0
DEL workers:leases
```

## Security

- **Secrets**: Never commit credentials to git
- **Fly Secrets**: Use `fly secrets set` for machine env vars
- **Wrangler Secrets**: Use `wrangler secret put` for worker env vars
- **Presigned URLs**: Prefer over storing R2 credentials in machines
- **Webhook Auth**: Add authentication tokens to webhook endpoints
- **Rate Limiting**: Built-in via Redis counters
- **Max Machines**: Hard cap prevents runaway costs

## Presets

### `web-optimized`
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac -b:a 128k \
  output.mp4
```

### `hls`
```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset fast -g 48 -sc_threshold 0 \
  -c:a aac -hls_time 4 -hls_playlist_type vod \
  output.m3u8
```

### `default`
```bash
ffmpeg -i input.mp4 -c copy output.mp4
```

## Scripts

```bash
# Deploy image
bun run deploy

# View logs
bun run logs

# Set secrets
bun run secrets:set KEY=value

# List machines
bun run machines:list

# Destroy all machines
bun run machines:destroy-all
```
