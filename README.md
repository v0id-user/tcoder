# TCoder

Serverless video transcoding pipeline with Redis orchestration. Event-driven architecture using Cloudflare Workers, R2, and Fly.io Machines.

## Architecture

![Event-Driven Serverless Transcoding Pipeline](./design/architecture/Event-Driven%20Serverless%20Transcoding%20Pipeline.png)

The pipeline consists of seven phases:

1. **Authorization** - Client requests presigned upload URL
2. **Ingestion** - Client uploads directly to R2, triggers event notification
3. **Orchestration** - RWOS enqueues job, spawns worker if capacity available
4. **Processing** - Fly Machine processes job, uploads outputs to R2
5. **Discoverability** - Webhook notifies control plane, updates job status
6. **Distribution** - Client fetches video via CDN
7. **Recovery** - Cron job detects dead workers, requeues stale jobs

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up R2 Buckets and Queue

```bash
# Create R2 buckets
wrangler r2 bucket create tcoder-input
wrangler r2 bucket create tcoder-output

# Create queue for event notifications
wrangler queues create tcoder-events

# Enable event notifications on input bucket
wrangler r2 bucket notification create tcoder-input \
  --event-type object-create \
  --queue tcoder-events
```

### 3. Set Cloudflare Worker Secrets

```bash
# Redis credentials
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN

# Fly.io credentials
wrangler secret put FLY_API_TOKEN
wrangler secret put FLY_APP_NAME      # fly-tcoder-ffmpeg-worker-31657fa
wrangler secret put FLY_REGION        # fra

# R2 credentials (for presigned URLs)
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_INPUT_BUCKET_NAME   # tcoder-input
wrangler secret put R2_OUTPUT_BUCKET_NAME  # tcoder-output

# Worker URL
wrangler secret put WEBHOOK_BASE_URL  # https://tcoder.<your-subdomain>.workers.dev
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

| Component | Purpose |
|-----------|---------|
| **Cloudflare Worker** | Control plane - API, event handling, job orchestration |
| **Upstash Redis** | State store - job queue, leases, counters |
| **Cloudflare R2** | Object storage - input/output video files |
| **Cloudflare Queues** | Event delivery - R2 notifications |
| **Fly.io Machines** | Compute - FFmpeg transcoding workers |
| **Bunny CDN** | Distribution - video streaming |

## Documentation

- [Fly.io Workers](./fly/README.md) - RWOS worker details, cost analysis
- [Architecture Diagrams](./design/architecture/RWOS/) - System design

## Scripts

```bash
bun run dev          # Local development
bun run deploy       # Deploy Cloudflare Worker
bun run fly:deploy   # Deploy Fly.io image
bun run fly:logs     # View Fly.io logs
bun run test         # Run tests
```
