# Fly.io Ephemeral FFmpeg Workers

FFmpeg transcoding jobs that run on Fly.io Machines. Each job gets its own machine, runs once, then shuts down.

## Table of Contents

- [What "Ephemeral" Means](#what-ephemeral-means)
- [How It Works](#how-it-works)
- [Why This Design](#why-this-design)
- [Architecture](#architecture)
- [Configuration Philosophy](#configuration-philosophy)
- [Technology Stack](#technology-stack)
- [Deployment](#deployment)
- [Cost Analysis](#cost-analysis)
- [Environment Variables](#environment-variables)
- [Presets](#presets)
- [Monitoring](#monitoring)
- [Debugging](#debugging)
- [Important Notes](#important-notes)
- [Integration with Main App](#integration-with-main-app)
- [Budget Optimization](#budget-optimization)
- [Security](#security)

## What "Ephemeral" Means

Ephemeral means temporary. These machines don't stay running.

**Normal server**: You start it, it runs 24/7, you pay for all that time even when it's idle.

**Ephemeral worker**: You create a machine when you need it, it does one job, then it stops. You only pay for the time it's actually working.

Think of it like this:
- Normal server = leaving a car running all day, paying for gas the whole time
- Ephemeral worker = starting the car, driving somewhere, turning it off when you arrive

## How It Works

1. You need to transcode a video
2. Your code calls the Fly Machines API to create a new machine
3. The machine starts up and downloads the input video from R2 storage
4. FFmpeg transcodes the video (may generate multiple quality variants)
5. Transcoding outputs are uploaded back to R2 storage
6. A webhook notification is sent to your Worker API with completion status and output URLs
7. Temporary files are cleaned up
8. The process exits and the machine automatically stops
9. You stop paying

No machines running = no cost. Only pay when work is happening.

## Why This Design

**Cost**: If you only process 10 videos per day, why pay for a server running 24/7? You only need compute for those 10 jobs.

**Simplicity**: Each job is isolated. If one job crashes, it doesn't affect others. No shared state, no cleanup needed.

**Scaling**: Need to process 100 videos? Create 100 machines. They all run in parallel, then shut down when done.

## Architecture

- **No long-running services** - machines created on-demand
- **One job = one machine** - process exits → machine stops → billing stops
- **Zero idle cost** - only pay for execution time
- **Shared CPU** - minimize costs ($0.0000008/sec ≈ $2/month for ~70 jobs/day)

## Configuration Philosophy

### What We DON'T Use

- ❌ `[http_service]` - this is not a web server
- ❌ `auto_start_machines` / `auto_stop_machines` - not applicable
- ❌ `min_machines_running` - we want zero idle machines
- ❌ Multiple CPUs - shared CPU is sufficient and cheapest
- ❌ Static IPs or ports - no network listening

### What We DO Use

- ✅ Minimal `fly.toml` (app name, region, dockerfile only)
- ✅ `fly deploy --build-only` (build image once)
- ✅ Fly Machines API (create machines programmatically)
- ✅ Environment variables (pass job parameters)
- ✅ Process exit = machine stop (automatic cleanup)

## Technology Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **Effect System**: Effect-TS for typed error handling
- **Process Execution**: Bun's native `$` API for shell commands
- **Storage**: Cloudflare R2 (S3-compatible) for input/output files
- **Container**: Docker with FFmpeg + Bun
- **Platform**: Fly.io Machines API
- **Components**:
  - R2 Client Service (`r2-client.ts`) - Handles download/upload operations
  - Webhook Client Service (`webhook-client.ts`) - Sends completion notifications

## Deployment

### 1. Initial Setup

```bash
cd fly

# Authenticate
fly auth login

# Deploy image (one-time, or when code changes)
bun run deploy
```

This builds and registers the Docker image. **No machines are created yet.**

### 2. Trigger Jobs

Jobs are triggered via the Fly Machines API, not by running containers.

```typescript
import { executeTranscodeJob } from "./machines";
import { Effect } from "effect";

const job = {
  jobId: crypto.randomUUID(),
  inputUrl: "https://r2.example.com/inputs/video.mp4?signature=...", // R2 presigned URL
  outputUrl: "https://r2.example.com/outputs/video.mp4",
  preset: "web-optimized",
  apiToken: process.env.FLY_API_TOKEN!,
  // Required: Webhook for completion notifications (Phase 4 - Discoverability Phase)
  webhookUrl: "https://api.example.com/webhooks/transcode-complete",
  // Optional: Multiple quality outputs
  outputQualities: ["480p", "720p", "1080p"],
  // Optional: R2 config (if not using presigned URLs)
  r2Config: {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME!,
  }
};

const program = executeTranscodeJob(job).pipe(
  Effect.provide(
    Layer.mergeAll(
      // Add your Fly config layer here
    )
  )
);

Effect.runPromise(program);
```

### 3. Machine Lifecycle

```
API Request → Machine Created → Download from R2 → FFmpeg Transcodes → Upload to R2 → Webhook Notification → Cleanup → Process Exits → Machine Stops → Billing Ends
              ↑                                                                                                                                    ↓
              Image from registry                                                                                                                  Auto-destroy
```

## Cost Analysis

**Pricing**: Shared CPU = ~$0.0000008/sec/MB RAM

**512MB machine**:
- $0.0004096/second
- $0.024576/minute
- $1.47456/hour

**Example load**:
- 100 jobs/day
- 2 minutes average per job
- 200 minutes total/day
- **Cost**: ~$5/day = ~$150/month

**Budget-friendly load** (target ≤ $5/month):
- ~11 minutes/day of compute
- ~5 jobs/day at 2 min each
- Or 3 jobs/day at 3 min each

## Environment Variables

Each job receives:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `JOB_ID` | Unique job identifier | Yes | `550e8400-e29b-41d4-a716-446655440000` |
| `INPUT_URL` | Source media URL (R2 presigned URL or direct URL) | Yes | `https://r2.example.com/video.mp4?signature=...` |
| `OUTPUT_URL` | Base destination URL in R2 | Yes | `https://r2.example.com/outputs/video.mp4` |
| `WEBHOOK_URL` | Worker API endpoint for completion notifications (Phase 4 - Discoverability Phase) | Yes | `https://api.example.com/webhooks/transcode-complete` |
| `PRESET` | FFmpeg preset | No | `web-optimized`, `hls`, `hls-adaptive`, `default` |
| `OUTPUT_QUALITIES` | Comma-separated quality list for multi-output | No | `480p,720p,1080p` |
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID (for direct bucket access) | No* | `abc123def456` |
| `R2_ACCESS_KEY_ID` | R2 access key ID | No* | `your-access-key` |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key | No* | `your-secret-key` |
| `R2_BUCKET_NAME` | R2 bucket name | No* | `video-storage` |
| `R2_ENDPOINT` | Custom R2 endpoint URL | No | `https://abc123.r2.cloudflarestorage.com` |

\* Required only if using direct bucket access instead of presigned URLs

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
  -c:a aac \
  -hls_time 4 -hls_playlist_type vod \
  output.m3u8
```

### `default`
```bash
ffmpeg -i input.mp4 -c copy output.mp4
```

## Monitoring

### List all machines
```bash
fly machines list
```

### Check machine status
```bash
fly machine status <machine-id>
```

### View logs
```bash
fly logs --machine <machine-id>
```

### Destroy stuck machines
```bash
fly machine destroy <machine-id>
```

## Debugging

If jobs aren't starting:

1. **Check image is deployed**:
   ```bash
   fly releases
   ```

2. **Verify API token**:
   ```bash
   fly auth token
   ```

3. **Test machine creation manually**:
   ```bash
   fly machine run \
     --env JOB_ID=test-123 \
     --env INPUT_URL=https://example.com/input.mp4 \
     --env OUTPUT_URL=/tmp/output.mp4 \
     --env WEBHOOK_URL=https://api.example.com/webhooks/transcode-complete \
     --env PRESET=default \
     registry.fly.io/fly-tcoder-ffmpeg-worker-31657fa:latest
   ```

4. **Check worker logs**:
   ```bash
   fly logs --app fly-tcoder-ffmpeg-worker-31657fa
   ```

## Important Notes

- **No running machines** = $0 cost when idle
- **Shared CPU** is sufficient for FFmpeg (no need for dedicated)
- **512MB RAM** handles most transcoding (increase if needed)
- **`auto_destroy: true`** cleans up machines after exit
- **`restart: "no"`** prevents retry loops on failure
- **Process exit code** determines success (0 = success, non-zero = failure)

## Integration with Main App

Your Cloudflare Worker should:

1. Receive transcode request
2. Store job metadata in database
3. Call `executeTranscodeJob()` with Fly config and webhook URL
4. Receive webhook notification when transcoding completes
5. Update job status with output URLs

### Triggering a Job

```typescript
// In your Cloudflare Worker
import { executeTranscodeJob } from "./machines";
import { Effect } from "effect";

app.post("/transcode", async (c) => {
  const { inputUrl, outputUrl } = await c.req.json();
  const jobId = crypto.randomUUID();

  const job = {
    jobId,
    inputUrl, // R2 presigned URL
    outputUrl, // Base R2 output URL
    preset: "web-optimized",
    apiToken: process.env.FLY_API_TOKEN!,
    webhookUrl: `${c.env.WORKER_URL}/webhooks/transcode-complete`, // Required: Your webhook endpoint (Phase 4 - Discoverability Phase)
    outputQualities: ["480p", "720p", "1080p"], // Optional: multiple qualities
  };

  // Trigger job (non-blocking)
  const machine = await executeTranscodeJob(job)
    .pipe(Effect.provide(flyConfigLayer))
    .pipe(Effect.runPromise);

  return c.json({ jobId, machineId: machine.id });
});
```

### Receiving Webhook Notifications

```typescript
// Webhook endpoint in your Cloudflare Worker
app.post("/webhooks/transcode-complete", async (c) => {
  const payload = await c.req.json();

  // payload structure:
  // {
  //   jobId: string,
  //   status: "completed" | "failed",
  //   inputUrl: string,
  //   outputs: Array<{ quality: string, url: string, preset: string }>,
  //   error?: string,
  //   duration?: number
  // }

  if (payload.status === "completed") {
    // Update database with output URLs
    await updateJobStatus(payload.jobId, {
      status: "completed",
      outputs: payload.outputs,
      duration: payload.duration,
    });

    // Notify client via WebSocket or push notification
    await notifyClient(payload.jobId, payload.outputs);
  } else {
    // Handle failure
    await updateJobStatus(payload.jobId, {
      status: "failed",
      error: payload.error,
    });
  }

  return c.json({ ok: true });
});
```

## Budget Optimization

To stay under $5/month:

1. **Limit concurrent jobs** to prevent cost spikes
2. **Use shared CPU** (not dedicated)
3. **Set memory to minimum** required (256-512MB)
4. **Enable auto_destroy** to clean up immediately
5. **Monitor costs** with `fly dashboard`
6. **Consider queueing** for rate limiting

## Security

- **Never commit** `FLY_API_TOKEN` or R2 credentials to git
- **Use secrets** for sensitive URLs and API keys
- **Use presigned URLs** when possible instead of storing R2 credentials in machines
- **Validate inputs** before creating machines
- **Set timeouts** to prevent runaway costs
- **Monitor anomalies** in machine creation rate
- **Secure webhook endpoints** with authentication tokens
- **Rotate R2 credentials** regularly if using direct bucket access

## Pipeline Components

The worker consists of several Effect-based services:

### R2 Client (`r2-client.ts`)
- Downloads input videos from R2 (presigned URLs or direct bucket access)
- Uploads transcoded outputs to R2 with metadata
- Handles errors with typed error channels
- **TODO**: Replace mock implementations with actual R2 SDK (`@aws-sdk/client-s3`)

### Webhook Client (`webhook-client.ts`)
- Sends completion notifications to Worker API (required)
- Includes job results, output URLs, and error information
- Implements Phase 4 (Discoverability Phase) from architecture - enables client awareness of new URLs
- **TODO**: Add retry logic with exponential backoff and timeout handling

### Worker (`worker.ts`)
- Orchestrates the complete pipeline:
  1. Download input from R2
  2. Execute FFmpeg transcoding
  3. Upload outputs to R2
  4. Send webhook notification
  5. Cleanup temporary files
- Supports multiple output qualities
- Proper error handling and cleanup on failure
