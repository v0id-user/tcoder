# TCoder

Implementation of an event-driven, serverless video transcoding pipeline. Composes Cloudflare Workers for orchestration, R2 for object storage, Upstash Redis for state management, and Fly.io Machines for compute. Built with TypeScript, Hono, and Effect.

This is a personal side project built to explore architectural tradeoffs in distributed orchestration, backpressure handling, and worker lifecycle management. It is not intended for production use.

## Architecture

Three-layer separation: control plane, state store, and compute plane. Each layer has distinct responsibilities and failure boundaries.

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Control Plane | Cloudflare Worker | API endpoints, admission control, machine lifecycle management |
| State Store | Upstash Redis | Job queue, machine pool tracking, job status |
| Compute Plane | Fly.io Machines | FFmpeg transcoding, R2 I/O operations |

![Event-Driven Serverless Transcoding Pipeline](./design/architecture/Event-Driven%20Serverless%20Transcoding%20Pipeline.png)

### System Design

![Redis Worker Orchestration System](./design/architecture/RWOS/Redis%20Worker%20Orchestration%20System.png)

![Admission Control Flow](./design/architecture/RWOS/Admission%20Control%20Flow.png)

![Worker Lifecycle](./design/architecture/RWOS/Worker%20Lifecycle.png)

## Event-Driven Design

R2 object creation events drive the pipeline. Uploads trigger queue messages, which update Redis state and trigger machine provisioning decisions.

1. **Upload**: Client requests presigned URL from Worker API. Uploads video directly to R2 input bucket.

2. **Event Notification**: R2 emits object-created event to Cloudflare Queue (`tcoder-events`).

3. **Queue Processing**: Worker queue handler receives batch, extracts job ID from object key, updates Redis job status to `pending`, enqueues job in sorted set.

4. **Admission Control**: Worker checks Redis machine pool for available capacity. If under limit, attempts to start stopped machine or spawn new Fly.io Machine.

5. **Job Processing**: Fly.io Machine polls Redis for jobs using `ZPOPMIN`. On job assignment, downloads input from R2, runs FFmpeg transcoding, uploads outputs to R2 output bucket.

6. **Completion**: Machine sends webhook to Worker API with job results. Worker updates Redis job status. Client polls status endpoint or receives webhook callback.

7. **Machine Lifecycle**: Idle machines remain in pool. Cron job stops machines idle beyond threshold. Stopped machines can be restarted for new jobs.

## Quick Start

### Prerequisites

- Bun runtime
- Cloudflare account (Workers, R2, Queues)
- Upstash account (Redis)
- Fly.io account

### Setup

1. **Install dependencies**:
   ```bash
   bun install
   ```

2. **Create R2 buckets and queue**:
   ```bash
   bunx wrangler r2 bucket create tcoder-input && \
   bunx wrangler r2 bucket create tcoder-output && \
   bunx wrangler queues create tcoder-events && \
   bunx wrangler r2 bucket notification create tcoder-input --event-type object-create --queue tcoder-events
   ```

3. **Set Cloudflare Worker secrets**:
   ```bash
   bunx wrangler secret bulk .env
   ```

   Required secrets (see `env.local.example`):
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `FLY_API_TOKEN`, `FLY_APP_NAME`, `FLY_REGION`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - `R2_INPUT_BUCKET_NAME`, `R2_OUTPUT_BUCKET_NAME`
   - `WEBHOOK_BASE_URL`

4. **Initialize Fly.io app**:
   ```bash
   bun run fly:first-launch
   ```

   Set Fly secrets (see [fly/README.md](./fly/README.md)).

5. **Deploy**:
   ```bash
   bun run deploy        # Cloudflare Worker
   bun run fly:deploy    # Fly.io image
   ```

## Project Structure

```
tcoder/
├── src/
│   ├── index.ts              # Worker entry, queue + cron handlers
│   ├── api/                  # Hono API routes
│   ├── r2/                   # Presigned URLs, event handling
│   ├── redis/                # Upstash client and schema
│   └── orchestration/        # Admission, spawner, machine pool
├── fly/
│   ├── ffmpeg-worker/        # Fly Machine worker code
│   └── Dockerfile            # Worker container
├── packages/
│   └── tcoder-client/        # TypeScript SDK
└── design/
    └── architecture/         # PlantUML diagrams
```

## Documentation

- [API Usage Guide](./USAGE.md) - CURL examples and API reference
- [Local Development](./LOCAL_DEV.md) - Docker Compose setup
- [Fly.io Workers](./fly/README.md) - Worker details, debugging
- [TypeScript SDK](./packages/tcoder-client/README.md) - Client library

## Scripts

```bash
bun run dev              # Local development
bun run deploy           # Deploy Cloudflare Worker
bun run fly:deploy       # Deploy Fly.io image
bun run fly:logs         # View Fly.io logs
bun run test             # Run tests
```
