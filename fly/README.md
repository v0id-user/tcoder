# Fly.io FFmpeg Workers

Pooled FFmpeg workers orchestrated via Redis. Machines are stopped when idle and reused when jobs arrive.

For system architecture, see the [main README](../README.md).

## How It Works

```
Job Submitted -> Redis Queue -> Worker Pops -> FFmpeg -> R2 Upload -> Webhook -> Next Job or Wait
                    ^                                                                  |
              Pool Management                                                   State: idle
              (reuse stopped)                                                  (poll continues)
                                                                                       |
                                                                                Cron stops if
                                                                                idle > 5 min
```

1. Worker polls Redis queue indefinitely with `ZPOPMIN`
2. Updates pool state: "running" when processing, "idle" when waiting
3. Cron stops machines idle for 5+ minutes, adds to stopped pool
4. Stopped machines are restarted when new jobs arrive

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

### Set Fly Secrets

```bash
fly secrets set \
  UPSTASH_REDIS_REST_URL="https://your-redis.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="your-token" \
  R2_ACCOUNT_ID="your-account-id" \
  R2_ACCESS_KEY_ID="your-access-key" \
  R2_SECRET_ACCESS_KEY="your-secret-key" \
  R2_OUTPUT_BUCKET_NAME="tcoder-output"
```

### Deploy Image

```bash
bun run deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_OUTPUT_BUCKET_NAME` | R2 output bucket name |

## Monitoring

```bash
# View logs
fly logs --app fly-tcoder-ffmpeg-worker-31657fa

# List machines
fly machines list
```

For API-based monitoring, see [USAGE.md](../USAGE.md).

## Debugging

### Job Stuck in "pending"

1. Check if workers exist: `fly machines list`
2. Check capacity: `GET /api/stats`
3. Check Redis queue: verify `jobs:pending` has entries

### Job Stuck in "running"

1. Check worker logs: `fly logs`
2. Check lease expiry in Redis
3. Wait for cron to requeue (1 min interval)

### Worker Not Processing

1. Verify Redis credentials: `fly secrets list`
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

## Presets

### web-optimized

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac -b:a 128k \
  output.mp4
```

### hls

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -preset fast -g 48 -sc_threshold 0 \
  -c:a aac -hls_time 4 -hls_playlist_type vod \
  output.m3u8
```

### default

```bash
ffmpeg -i input.mp4 -c copy output.mp4
```

## Security

- Never commit credentials to git
- Use `fly secrets set` for env vars
- Presigned URLs preferred over storing R2 credentials
- Pool size limit (10) prevents resource exhaustion

## Scripts

```bash
bun run deploy            # Deploy image
bun run logs              # View logs
bun run machines:list     # List machines
bun run machines:destroy-all  # Destroy all machines
```
