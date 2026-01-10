# API

Base: `https://tcoder.your-subdomain.workers.dev`

## Endpoints

### GET /
Health check.

### GET /api/status
Redis connectivity check.

### POST /api/upload
Request presigned upload URL.

```bash
curl -X POST /api/upload \
  -H "Content-Type: application/json" \
  -d '{"filename": "video.mp4", "preset": "web-optimized", "outputQualities": ["720p", "1080p"]}'
```

```json
{"jobId": "uuid", "uploadUrl": "https://...", "expiresAt": 1703520000000, "inputKey": "inputs/uuid/video.mp4"}
```

### PUT {uploadUrl}
Upload file to R2.

```bash
curl -X PUT "UPLOAD_URL" -H "Content-Type: video/mp4" --data-binary @video.mp4
```

### GET /api/jobs/:jobId
Get job status.

```json
{"jobId": "uuid", "status": "completed", "outputs": [{"quality": "720p", "url": "https://..."}], "timestamps": {...}}
```

### POST /api/jobs
Direct job submission (skip upload).

```bash
curl -X POST /api/jobs \
  -H "Content-Type: application/json" \
  -d '{"inputUrl": "https://...", "outputUrl": "outputs/job", "preset": "hls"}'
```

### GET /api/stats
System stats.

```json
{"machines": {"activeMachines": 2, "maxMachines": 5}, "pendingJobs": 5, "activeJobs": 2}
```

## Status Values

`uploading` -> `queued` -> `pending` -> `running` -> `completed` | `failed`
