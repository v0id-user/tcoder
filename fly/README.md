# Fly Workers

Pooled FFmpeg workers. Redis orchestration. Stopped when idle, reused on demand.

## Redis Keys

| Key | Type | Data |
|-----|------|------|
| `jobs:pending` | ZSET | job queue (score = timestamp) |
| `jobs:active` | HASH | jobId -> machineId |
| `jobs:status:{id}` | HASH | job metadata |
| `machines:pool` | HASH | machineId -> {state, lastActiveAt, createdAt} |
| `machines:stopped` | SET | available machine IDs |

## Constants

- IDLE_TIMEOUT: 5 min
- POLL_INTERVAL: 5 sec
- MAX_MACHINES: 10

## Secrets

```bash
fly secrets set \
  UPSTASH_REDIS_REST_URL="..." \
  UPSTASH_REDIS_REST_TOKEN="..." \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_OUTPUT_BUCKET_NAME="tcoder-output"
```

## Deploy

```bash
bun run deploy
```

## Presets

```bash
# web-optimized
ffmpeg -i input.mp4 -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k output.mp4

# hls
ffmpeg -i input.mp4 -c:v libx264 -preset fast -g 48 -sc_threshold 0 -c:a aac -hls_time 4 -hls_playlist_type vod output.m3u8

# default
ffmpeg -i input.mp4 -c copy output.mp4
```

## Debug

```bash
fly machines list
fly logs
curl /api/stats

# force cleanup
fly machines list --json | jq -r '.[].id' | xargs -I {} fly machine destroy {} --force
```

## Cost

~$0.0004/sec (512MB shared). Stopped = $0.
