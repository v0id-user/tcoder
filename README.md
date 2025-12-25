# TCoder

Serverless video transcoding pipeline with Redis orchestration. Event-driven architecture using Cloudflare Workers, R2, and Fly.io Machines.

## Architecture

TCoder uses a **three-layer architecture** with RWOS (Redis Worker Orchestration System) for job orchestration:

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| **Control Plane** | Cloudflare Worker | API endpoints, admission control, machine spawning, event handling |
| **State Store** | Upstash Redis | Job queue, worker leases, concurrency counters, job status |
| **Compute Plane** | Fly.io Machines | FFmpeg transcoding, R2 I/O, webhook notifications |

![Event-Driven Serverless Transcoding Pipeline](./design/architecture/Event-Driven%20Serverless%20Transcoding%20Pipeline.png)

### Pipeline Phases

The pipeline consists of seven phases:

1. **Authorization** - Client requests presigned upload URL from control plane
2. **Ingestion** - Client uploads directly to R2, triggers Cloudflare Queue event notification
3. **Orchestration (RWOS)** - Control plane enqueues job to Redis, checks rate limits and capacity, spawns Fly Machine if needed
4. **Processing** - Fly Machine acquires lease, polls Redis queue, processes multiple jobs (up to 3) within TTL (5 min), uploads outputs to R2
5. **Discoverability** - Worker sends webhook to control plane, updates job status in Redis
6. **Distribution** - Client fetches transcoded video via CDN
7. **Recovery** - Cron job (every minute) detects expired worker leases, requeues stale jobs

### RWOS Components

![Redis Worker Orchestration System](./design/architecture/RWOS/Redis%20Worker%20Orchestration%20System.png)

**Control Plane (Cloudflare Worker):**
- **Hono API** - Job submission endpoints (`POST /api/upload`, `GET /api/jobs/:id`)
- **Admission Controller** - Rate limiting (1 req/sec) + capacity enforcement (max 5 machines)
- **Machine Spawner** - Fly API calls with exponential backoff retry
- **Cron Handler** - Stale job recovery, expired lease cleanup

**State Store (Upstash Redis):**
- `jobs:pending` (ZSET) - Job queue sorted by timestamp
- `jobs:active` (HASH) - job_id → machine_id mapping
- `jobs:status:{id}` (HASH) - Job metadata and status
- `workers:leases` (HASH) - machine_id → expiry timestamp
- `counters:active_machines` (STRING) - Current machine count
- `counters:rate_limit` (STRING) - API rate limit counter (1s TTL)

**Compute Plane (Fly Machine):**
- TTL-bounded workers (5 minute lifetime)
- Process 1-3 jobs per worker (configurable)
- Poll Redis queue with `ZPOPMIN` (atomic job claim)
- Graceful drain mode when TTL < 60s or max jobs reached

### Admission Control Flow

![Admission Control Flow](./design/architecture/RWOS/Admission%20Control%20Flow.png)

When a job is submitted:
1. **Rate Limit Check** - `INCR counters:rate_limit` (TTL 1s), retry if count > 1
2. **Capacity Check** - `GET counters:active_machines`, proceed if < MAX_MACHINES (5)
3. **Reserve Slot** - `INCR counters:active_machines` (atomic reservation)
4. **Create Machine** - POST to Fly Machines API with exponential backoff
5. **Register Lease** - `HSET workers:leases` with expiry timestamp

### Worker Lifecycle

![Worker Lifecycle](./design/architecture/RWOS/Worker%20Lifecycle.png)

**States:**
- **Starting** - Machine boots, connects to Redis, acquires lease
- **Active** - Polling queue, processing jobs (up to 3), checking TTL
- **Draining** - TTL < 60s or max jobs reached, no new jobs accepted
- **Exiting** - Release lease, decrement counter, cleanup, exit

**Key Constants:**
- TTL: 5 minutes
- MAX_JOBS: 3 per worker
- POLL_INTERVAL: 5 seconds
- DRAIN_BUFFER: 60 seconds before TTL expiry

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up R2 Buckets and Queue

```bash
# Create R2 buckets
bunx wrangler r2 bucket create tcoder-input
bunx wrangler r2 bucket create tcoder-output

# Create queue for event notifications
bunx wrangler queues create tcoder-events

# Enable event notifications on input bucket
bunx wrangler r2 bucket notification create tcoder-input --event-type object-create --queue tcoder-events
```

**One-liner (all at once):**
```bash
bunx wrangler r2 bucket create tcoder-input && bunx wrangler r2 bucket create tcoder-output && bunx wrangler queues create tcoder-events && bunx wrangler r2 bucket notification create tcoder-input --event-type object-create --queue tcoder-events
```

### 3. Set Cloudflare Worker Secrets

```bash
# Redis credentials
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN

# Fly.io credentials
bunx wrangler secret put FLY_API_TOKEN
bunx wrangler secret put FLY_APP_NAME      # fly-tcoder-ffmpeg-worker-31657fa
bunx wrangler secret put FLY_REGION        # fra

# R2 credentials (for presigned URLs)
wrangler secret put R2_ACCOUNT_ID

wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

wrangler secret put R2_INPUT_BUCKET_NAME   # tcoder-input
wrangler secret put R2_OUTPUT_BUCKET_NAME  # tcoder-output

# Worker URL
wrangler secret put WEBHOOK_BASE_URL  # https://tcoder.<your-subdomain>.workers.dev

# or
bunx wrangler secret bulk .env
```

### 4. Set Up Fly.io Workers

```bash
# First launch (creates app and deploys image)
bun run fly:first-launch

# Set Fly secrets
cd fly
fly secrets set \
  UPSTASH_REDIS_REST_URL="https://your-redis.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="your-token" \
  R2_ACCOUNT_ID="your-account" \
  R2_ACCESS_KEY_ID="your-key" \
  R2_SECRET_ACCESS_KEY="your-secret" \
  R2_BUCKET_NAME="tcoder-output"
```

### 5. Deploy

```bash
# Deploy Cloudflare Worker
bun run deploy

# Deploy Fly.io image (when code changes)
bun run fly:deploy
```

## API Endpoints

> **📖 For complete API documentation with CURL examples, see [USAGE.md](./USAGE.md)**

### `POST /api/upload` - Request Upload URL

```bash
curl -X POST https://tcoder.workers.dev/api/upload \
  -H "Content-Type: application/json" \
  -d '{"filename": "video.mp4", "preset": "web-optimized"}'
```

Response:
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://...",
  "expiresAt": 1703520000000,
  "inputKey": "inputs/550e8400.../video.mp4"
}
```

### `GET /api/jobs/:jobId` - Poll Job Status

```bash
curl https://tcoder.workers.dev/api/jobs/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "outputs": [
    { "quality": "720p", "url": "https://..." }
  ],
  "timestamps": {
    "createdAt": 1703516400000,
    "uploadedAt": 1703516401000,
    "startedAt": 1703516402000,
    "completedAt": 1703516500000
  }
}
```

### `GET /api/stats` - System Stats

```bash
curl https://tcoder.workers.dev/api/stats
```

Response:
```json
{
  "machines": { "activeMachines": 2, "maxMachines": 5 },
  "pendingJobs": 5,
  "activeJobs": 2
}
```

## Job Status Flow

```
uploading → queued → pending → running → completed
                                      → failed
```

| Status | Description |
|--------|-------------|
| `uploading` | Presigned URL generated, waiting for upload |
| `queued` | Upload complete, event received |
| `pending` | In job queue, waiting for worker |
| `running` | Worker processing |
| `completed` | Done, outputs available |
| `failed` | Error occurred |

## Full Upload Flow (Client Example)

```typescript
// 1. Request upload URL
const { jobId, uploadUrl } = await fetch('/api/upload', {
  method: 'POST',
  body: JSON.stringify({ filename: 'video.mp4', preset: 'web-optimized' })
}).then(r => r.json());

// 2. Upload directly to R2
await fetch(uploadUrl, {
  method: 'PUT',
  body: videoFile,
  headers: { 'Content-Type': 'video/mp4' }
});

// 3. Poll for completion
const poll = async () => {
  const job = await fetch(`/api/jobs/${jobId}`).then(r => r.json());

  if (job.status === 'completed') {
    return job.outputs;
  } else if (job.status === 'failed') {
    throw new Error(job.error);
  } else {
    await new Promise(r => setTimeout(r, 2000));
    return poll();
  }
};

const outputs = await poll();
console.log('Video ready:', outputs);
```

## Project Structure

```
tcoder/
├── src/
│   ├── index.ts              # Worker entry, queue + cron handlers
│   ├── api/
│   │   └── routes.ts         # Hono API routes
│   ├── r2/
│   │   ├── presigned.ts      # Presigned URL generation
│   │   └── events.ts         # R2 event notification handler
│   ├── redis/
│   │   ├── client.ts         # Upstash Redis client
│   │   └── schema.ts         # Redis keys and types
│   └── orchestration/
│       ├── admission.ts      # Rate limiting + capacity control
│       ├── job-manager.ts    # Job queue operations
│       └── spawner.ts        # Fly Machine creation
├── fly/
│   ├── ffmpeg-worker/        # Fly Machine worker code
│   ├── Dockerfile            # Worker container
│   └── README.md             # Detailed Fly.io docs
└── design/
    └── architecture/         # PlantUML diagrams
```

## Infrastructure

| Component | Layer | Purpose |
|-----------|-------|---------|
| **Cloudflare Worker** | Control Plane | API endpoints, admission control, machine spawning, R2 event handling, cron recovery |
| **Upstash Redis** | State Store | Job queue (ZSET), worker leases (HASH), concurrency counters, job status tracking |
| **Cloudflare R2** | Storage | Object storage for input/output video files, presigned URL generation |
| **Cloudflare Queues** | Event Delivery | R2 event notifications (object-create → queue → worker handler) |
| **Fly.io Machines** | Compute Plane | TTL-bounded FFmpeg workers, multi-job processing, webhook notifications |
| **Bunny CDN** | Distribution | Video streaming CDN (optional, outputs can be served directly from R2) |

**See [Architecture Diagrams](./design/architecture/RWOS/) for detailed system design.**

## Local Development

```bash
bun run dev
```

Starts everything:
- Fly-worker container (polls Redis for jobs)
- Wrangler dev (API at localhost:8787)
- Scheduled trigger (every 5 minutes)

**Prerequisites:**
- Bun runtime
- Docker
- Upstash Redis account (free tier)
- `.dev.vars` + `.env` configured

**See [LOCAL_DEV.md](./LOCAL_DEV.md) for setup.**

## Documentation

- [API Usage Guide](./USAGE.md) - Complete CURL examples and API reference
- [Local Development](./LOCAL_DEV.md) - Local dev setup with Docker Compose
- [Fly.io Workers](./fly/README.md) - RWOS worker details, cost analysis
- [Architecture Diagrams](./design/architecture/RWOS/) - System design

## Scripts

```bash
bun run dev              # Start everything (fly-worker + wrangler + trigger)
bun run deploy           # Deploy Cloudflare Worker
bun run fly:deploy       # Deploy Fly.io image
bun run fly:logs         # View Fly.io logs
bun run test             # Run tests
```
