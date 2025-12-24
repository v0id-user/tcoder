# Fly.io Ephemeral FFmpeg Workers

FFmpeg transcoding jobs that run on Fly.io Machines. Each job gets its own machine, runs once, then shuts down.

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
3. The machine starts up and runs FFmpeg
4. When FFmpeg finishes, the process exits
5. The machine automatically stops
6. You stop paying

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

❌ `[http_service]` - this is not a web server
❌ `auto_start_machines` / `auto_stop_machines` - not applicable
❌ `min_machines_running` - we want zero idle machines
❌ Multiple CPUs - shared CPU is sufficient and cheapest
❌ Static IPs or ports - no network listening

### What We DO Use

✅ Minimal `fly.toml` (app name, region, dockerfile only)
✅ `fly deploy --build-only` (build image once)
✅ Fly Machines API (create machines programmatically)
✅ Environment variables (pass job parameters)
✅ Process exit = machine stop (automatic cleanup)

## Technology Stack

- **Runtime**: Bun (fast JavaScript runtime)
- **Effect System**: Effect-TS for typed error handling
- **Process Execution**: Bun's native `$` API for shell commands
- **Container**: Docker with FFmpeg + Bun
- **Platform**: Fly.io Machines API

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
import { executeTranscodeJob, makeFlyConfigLayer } from "./fly-machines-client";
import { Effect } from "effect";

const job = {
  jobId: crypto.randomUUID(),
  inputUrl: "https://storage.example.com/input.mp4",
  outputUrl: "https://storage.example.com/output.mp4",
  preset: "web-optimized"
};

const program = executeTranscodeJob(job).pipe(
  Effect.provide(
    makeFlyConfigLayer({
      apiToken: process.env.FLY_API_TOKEN!,
      appName: "fly-tcoder-ffmpeg-worker-31657fa",
      region: "fra"
    })
  )
);

Effect.runPromise(program);
```

### 3. Machine Lifecycle

```
API Request → Machine Created → FFmpeg Runs → Process Exits → Machine Stops → Billing Ends
              ↑                                              ↓
              Image from registry                            Auto-destroy
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

| Variable | Description | Example |
|----------|-------------|---------|
| `JOB_ID` | Unique job identifier | `550e8400-e29b-41d4-a716-446655440000` |
| `INPUT_URL` | Source media URL | `https://cdn.example.com/video.mp4` |
| `OUTPUT_URL` | Destination URL | `https://storage.example.com/out.mp4` |
| `PRESET` | FFmpeg preset | `web-optimized`, `hls`, `default` |

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
3. Call `executeTranscodeJob()` with Fly config
4. Poll or webhook for completion
5. Update job status

```typescript
// In your Cloudflare Worker
import { executeTranscodeJob } from "./fly-machines-client";

app.post("/transcode", async (c) => {
  const { inputUrl, outputUrl } = await c.req.json();

  const job = {
    jobId: crypto.randomUUID(),
    inputUrl,
    outputUrl,
    preset: "web-optimized"
  };

  // Trigger job (non-blocking)
  const machine = await executeTranscodeJob(job)
    .pipe(Effect.provide(flyConfigLayer))
    .pipe(Effect.runPromise);

  return c.json({ jobId: job.jobId, machineId: machine.id });
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

- **Never commit** `FLY_API_TOKEN` to git
- **Use secrets** for sensitive URLs
- **Validate inputs** before creating machines
- **Set timeouts** to prevent runaway costs
- **Monitor anomalies** in machine creation rate
