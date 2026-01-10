# TCoder

Serverless video transcoding pipeline with Redis orchestration. Event-driven architecture using Cloudflare Workers, R2, and Fly.io Machines.

## Architecture

TCoder uses a three-layer architecture with RWOS (Redis Worker Orchestration System):

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| Control Plane | Cloudflare Worker | API, admission control, machine spawning |
| State Store | Upstash Redis | Job queue, machine pool, status tracking |
| Compute Plane | Fly.io Machines | FFmpeg transcoding, R2 I/O |

![Event-Driven Serverless Transcoding Pipeline](./design/architecture/Event-Driven%20Serverless%20Transcoding%20Pipeline.png)

### System Design

![Redis Worker Orchestration System](./design/architecture/RWOS/Redis%20Worker%20Orchestration%20System.png)

![Admission Control Flow](./design/architecture/RWOS/Admission%20Control%20Flow.png)

![Worker Lifecycle](./design/architecture/RWOS/Worker%20Lifecycle.png)

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Set Up R2 Buckets and Queue

```bash
bunx wrangler r2 bucket create tcoder-input && \
bunx wrangler r2 bucket create tcoder-output && \
bunx wrangler queues create tcoder-events && \
bunx wrangler r2 bucket notification create tcoder-input --event-type object-create --queue tcoder-events
```

### 3. Set Cloudflare Worker Secrets

```bash
# All secrets at once
bunx wrangler secret bulk .env
```

Required secrets (see `env.local.example`):
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `FLY_API_TOKEN`, `FLY_APP_NAME`, `FLY_REGION`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `R2_INPUT_BUCKET_NAME`, `R2_OUTPUT_BUCKET_NAME`
- `WEBHOOK_BASE_URL`

### 4. Set Up Fly.io Workers

```bash
bun run fly:first-launch
```

Then set Fly secrets (see [fly/README.md](./fly/README.md) for details).

### 5. Deploy

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
