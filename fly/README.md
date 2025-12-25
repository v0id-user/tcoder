# Fly.io FFmpeg Workers with Redis Orchestration (RWOS)

Pooled FFmpeg workers orchestrated via Redis. Machines are stopped when idle and reused when jobs arrive, minimizing Fly API calls and costs.

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
2. **Admission Control**: Check pool capacity (max 10 machines: running + stopped)
3. **Machine Reuse**: Check stopped machines first, start one if available
4. **Machine Spawn**: If no stopped machines and pool not full, create new machine
5. **Job Processing**: Worker polls queue indefinitely, pops jobs, processes
6. **State Updates**: Worker updates pool state: "running" when processing, "idle" when waiting
7. **Idle Management**: Cron stops machines idle for 5+ minutes, adds to stopped pool

```
Job Submitted → Redis Queue → Worker Pops → FFmpeg → R2 Upload → Webhook → Next Job or Wait
                    ↑                                                              ↓
              Pool Management                                              State: idle
              (reuse stopped)                                             (poll continues)
                                                                           ↓
                                                                    Cron stops if
                                                                    idle > 5 min
```

## Key Differences from Ephemeral Model

| Aspect | Old (Ephemeral) | New (Pooled RWOS) |
|--------|-----------------|-------------------|
| Jobs per machine | 1 | Unlimited (indefinite polling) |
| Machine lifetime | Job duration | Until stopped (idle > 5 min) |
| Job discovery | Env vars at creation | Redis queue polling |
| State management | None | Redis pool (running/idle/stopped) |
| Machine reuse | None | Stopped machines restarted |
| Failure handling | None | Automatic requeue |
| API calls | 1 per job | Minimal (reuse stopped machines) |
| Observability | Fly logs only | Redis pool + logs |

## RWOS Components

### Control Plane (Cloudflare Worker)

- **Hono API**: Job submission endpoints (`POST /api/jobs`)
- **Admission Controller**: Pool-based capacity enforcement (max 10 machines)
- **Machine Spawner**: Reuses stopped machines first, creates new if needed
- **Cron Handler**: Stops idle machines (every minute), adds to stopped pool

### State Store (Upstash Redis)

| Key | Type | Purpose |
|-----|------|---------|
| `jobs:pending` | ZSET | Job queue sorted by timestamp |
| `jobs:active` | HASH | job_id → machine_id mapping |
| `jobs:status:{id}` | HASH | Job metadata and status |
| `machines:pool` | HASH | machine_id → JSON {state, lastActiveAt, createdAt} |
| `machines:stopped` | SET | machineIds available to start |

### Compute Plane (Fly Machine)

- **Redis Client**: Polls job queue indefinitely, updates status
- **Pool Manager**: Updates pool state (running/idle), tracks lastActiveAt
- **FFmpeg Pipeline**: Download → transcode → upload
- **Webhook Client**: Notifies control plane on completion

## Worker Lifecycle

![Worker Lifecycle](../design/architecture/RWOS/Worker%20Lifecycle.png)

**States:**
1. **Starting**: Machine boots, connects to Redis, initializes in pool
2. **Running**: Processing jobs, updates pool state to "running"
3. **Idle**: No jobs available, waiting and polling, updates pool state to "idle"
4. **Stopped**: Stopped by cron when idle > 5 minutes, added to stopped pool

**Transitions:**
- Starting → Running: Pool entry created, ready to process
- Running → Idle: No jobs available, continue polling
- Idle → Running: Job popped from queue
- Idle → Stopped: Cron stops machine (idle > 5 min)
- Stopped → Running: Machine restarted when jobs arrive

## Admission Control

![Admission Control Flow](../design/architecture/RWOS/Admission%20Control%20Flow.png)

**Machine Reuse (First Priority):**
```
SPOP machines:stopped
if machine_id found: start machine via Fly API
else: check pool capacity
```

**Pool Capacity Check:**
```
HGETALL machines:pool
count = running + stopped machines
if count >= 10: job stays queued
else: create new machine
```

**Backoff on Fly API errors:**
- 429 (rate limit): exponential backoff (Fly handles rate limiting)
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

### Machine Pool Entry
```
machines:pool
├── {machine_id}: JSON {
│   ├── state: "running" | "idle" | "stopped"
│   ├── lastActiveAt: timestamp
│   └── createdAt: timestamp
│   }
└── ...
```

### Stopped Machines Set
```
machines:stopped
├── {machine_id_1}
├── {machine_id_2}
└── ...
```

## Deployment

### 1. Set Fly Secrets

```bash
cd fly

fly secrets set \
  UPSTASH_REDIS_REST_URL="https://your-redis.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="your-token" \
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
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
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

**Pooled RWOS reduces costs by reusing machines:**

| Metric | Ephemeral (1 job/machine) | Pooled RWOS |
|--------|---------------------------|-------------|
| Machine creates/day | 100 | ~10-20 (reused) |
| Fly API calls/day | 100 | ~10-20 (mostly starts) |
| Startup overhead | 100× | ~10-20× |
| Effective cost | 100% | ~10-20% |

**Pricing (512MB shared CPU):**
- ~$0.0004/second
- ~$0.024/minute
- Machines only run when processing jobs
- Stopped machines cost $0 (billing stops)

**Cost Savings:**
- Machines stopped when idle (no cost)
- Reused when jobs arrive (no create overhead)
- Only pay for active processing time
- Pool size limit (10) prevents runaway costs

**Budget targets:**
- $5/month ≈ 200+ jobs (with reuse)
- $10/month ≈ 400+ jobs

## Monitoring

### Check System Stats
```bash
curl https://your-worker.workers.dev/api/stats
```

Response:
```json
{
  "machines": { "activeMachines": 8, "maxMachines": 10 },
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

# Reset Redis pool (via redis-cli or Upstash console)
DEL machines:pool
DEL machines:stopped
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
