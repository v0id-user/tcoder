# API Usage Guide

CURL examples for the TCoder transcoding API.

## Base URL

Replace `https://tcoder.your-subdomain.workers.dev` with your actual Cloudflare Worker URL.

## 1. Health Check

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/"
```

Response:

```json
{
  "status": "ok",
  "service": "tcoder"
}
```

## 2. Status Endpoint

Verifies Redis connectivity and returns server time.

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/status"
```

Response (success):

```json
{
  "status": "ok",
  "serverTime": {
    "timestamp": 1703510400000,
    "iso": "2023-12-25T12:00:00.000Z",
    "utc": "Mon, 25 Dec 2023 12:00:00 GMT"
  },
  "redis": {
    "connected": true,
    "ping": "PONG",
    "testRead": true
  }
}
```

Response (Redis error):

```json
{
  "status": "error",
  "serverTime": { ... },
  "redis": {
    "connected": false,
    "error": "Connection timeout"
  }
}
```

## 3. Upload Flow

Complete workflow for uploading and transcoding a video file.

### Step 1: Request Presigned Upload URL

```bash
curl -X POST "https://tcoder.your-subdomain.workers.dev/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "my-video.mp4",
    "contentType": "video/mp4",
    "preset": "web-optimized",
    "outputQualities": ["720p", "1080p"]
  }'
```

Request parameters:
- `filename` (required): Name of the file to upload
- `contentType` (optional): MIME type, defaults to `"video/mp4"`
- `preset` (optional): `"default"`, `"web-optimized"`, `"hls"`, or `"hls-adaptive"`
- `outputQualities` (optional): Array like `["720p", "1080p"]`

Response:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://xxx.r2.cloudflarestorage.com/tcoder-input/inputs/550e8400.../my-video.mp4?X-Amz-Algorithm=...",
  "expiresAt": 1703520000000,
  "inputKey": "inputs/550e8400-e29b-41d4-a716-446655440000/my-video.mp4"
}
```

The presigned URL expires in 1 hour.

### Step 2: Upload File to R2

```bash
curl -X PUT "UPLOAD_URL_FROM_STEP_1" \
  -H "Content-Type: video/mp4" \
  --data-binary @my-video.mp4
```

### Step 3: Check Job Status

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/jobs/550e8400-e29b-41d4-a716-446655440000"
```

Response (running):

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "machineId": "machine-abc123",
  "outputs": null,
  "error": null,
  "timestamps": {
    "createdAt": 1703516400000,
    "uploadedAt": 1703516401000,
    "queuedAt": 1703516402000,
    "startedAt": 1703516403000
  },
  "filename": "my-video.mp4",
  "preset": "web-optimized"
}
```

Response (completed):

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "machineId": "machine-abc123",
  "outputs": [
    {
      "quality": "720p",
      "url": "https://xxx.r2.cloudflarestorage.com/tcoder-output/outputs/550e8400.../720p.mp4"
    },
    {
      "quality": "1080p",
      "url": "https://xxx.r2.cloudflarestorage.com/tcoder-output/outputs/550e8400.../1080p.mp4"
    }
  ],
  "error": null,
  "timestamps": {
    "createdAt": 1703516400000,
    "uploadedAt": 1703516401000,
    "queuedAt": 1703516402000,
    "startedAt": 1703516403000,
    "completedAt": 1703516500000
  },
  "filename": "my-video.mp4",
  "preset": "web-optimized"
}
```

Response (failed):

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "machineId": null,
  "outputs": null,
  "error": "Transcoding failed: invalid video format",
  "timestamps": { ... },
  "filename": "my-video.mp4",
  "preset": "web-optimized"
}
```

## 4. Direct Job Submission

Submit a transcoding job with an existing input URL (skip upload).

```bash
curl -X POST "https://tcoder.your-subdomain.workers.dev/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "inputUrl": "https://example.com/video.mp4",
    "outputUrl": "outputs/my-job",
    "preset": "hls",
    "outputQualities": ["480p", "720p", "1080p"],
    "r2Config": {
      "accountId": "your-r2-account-id",
      "accessKeyId": "your-access-key",
      "secretAccessKey": "your-secret-key",
      "bucketName": "tcoder-output",
      "endpoint": "https://xxx.r2.cloudflarestorage.com"
    }
  }'
```

Request parameters:
- `jobId` (optional): Custom job ID (UUID)
- `inputUrl` (required): Full URL to the input video file
- `outputUrl` (required): Base path for output files
- `preset` (optional): Transcoding preset
- `outputQualities` (optional): Array of quality strings
- `r2Config` (optional): R2 credentials for output storage

Response:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "machineId": "machine-abc123",
  "queuedAt": 1703516400000
}
```

## 5. Job Status Flow

```
uploading -> queued -> pending -> running -> completed
                                          -> failed
```

| Status | Description |
|--------|-------------|
| `uploading` | Presigned URL generated, waiting for upload |
| `queued` | Upload complete, event received |
| `pending` | In job queue, waiting for worker |
| `running` | Worker processing |
| `completed` | Done, outputs available |
| `failed` | Error occurred |

## 6. System Stats

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/stats"
```

Response:

```json
{
  "machines": {
    "activeMachines": 2,
    "maxMachines": 5,
    "capacityAvailable": true
  },
  "pendingJobs": 5,
  "activeJobs": 2,
  "activeJobIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

## 7. Webhook Endpoint

Internal endpoint called by Fly.io workers on job completion.

```bash
curl -X POST "https://tcoder.your-subdomain.workers.dev/webhooks/job-complete" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "inputUrl": "https://xxx.r2.cloudflarestorage.com/tcoder-input/inputs/550e8400.../video.mp4",
    "outputs": [
      {
        "quality": "720p",
        "url": "https://xxx.r2.cloudflarestorage.com/tcoder-output/outputs/550e8400.../720p.mp4",
        "preset": "web-optimized"
      }
    ],
    "duration": 45.2
  }'
```

## Error Responses

```json
{ "error": "Job not found" }           // 404
{ "error": "Invalid job data" }        // 500
{ "error": "Validation failed", "details": "..." }  // 400
```

## Notes

- Presigned URLs expire after 1 hour
- Job status retained for 24 hours
- Maximum retries: 3
- Maximum concurrent machines: 5 (configurable)

### Automatic Recovery

Jobs stuck in `uploading` status are automatically recovered:

- After ~65 minutes, system checks if file exists in R2
- If file exists: job transitions to `pending`
- If file missing after ~2 hours: job marked as `failed`
