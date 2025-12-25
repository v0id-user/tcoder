# API Usage Guide - CURL Examples

This guide provides practical CURL examples for testing the TCoder transcoding API.

## Base URL

Replace `https://tcoder.your-subdomain.workers.dev` with your actual Cloudflare Worker URL in all examples below.

---

## 1. Health Check

Test if the service is running.

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/"
```

**Response:**
```json
{
  "status": "ok",
  "service": "tcoder"
}
```

---

## 2. Upload Flow

Complete workflow for uploading a video file and transcoding it.

### Step 1: Request Presigned Upload URL

Request a presigned URL to upload your video file directly to R2.

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

**Request Parameters:**
- `filename` (required): Name of the file to upload
- `contentType` (optional): MIME type, defaults to `"video/mp4"`
- `preset` (optional): Transcoding preset - `"default"`, `"web-optimized"`, `"hls"`, or `"hls-adaptive"`. Defaults to `"default"`
- `outputQualities` (optional): Array of output quality strings (e.g., `["720p", "1080p"]`)

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://xxx.r2.cloudflarestorage.com/tcoder-input/inputs/550e8400.../my-video.mp4?X-Amz-Algorithm=...",
  "expiresAt": 1703520000000,
  "inputKey": "inputs/550e8400-e29b-41d4-a716-446655440000/my-video.mp4"
}
```

**Note:** The presigned URL expires in 1 hour (3600 seconds).

### Step 2: Upload File to R2

Upload your video file using the presigned URL from Step 1. Use `PUT` method with the file content.

```bash
curl -X PUT "https://xxx.r2.cloudflarestorage.com/tcoder-input/inputs/550e8400.../my-video.mp4?X-Amz-Algorithm=..." \
  -H "Content-Type: video/mp4" \
  --data-binary @my-video.mp4
```

**Note:** Replace the URL with the `uploadUrl` from Step 1 response, and `@my-video.mp4` with the path to your video file. The `Content-Type` header should match the `contentType` you specified in Step 1.

### Step 3: Check Job Status

After uploading, check the job status. The job will automatically transition from `uploading` → `queued` → `pending` → `running` → `completed` (or `failed`).

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/jobs/550e8400-e29b-41d4-a716-446655440000"
```

**Note:** Replace `550e8400-e29b-41d4-a716-446655440000` with the `jobId` from Step 1. Run this command multiple times to check status until the job completes.

**Response (while processing):**
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

**Response (completed):**
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

**Response (failed):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "machineId": null,
  "outputs": null,
  "error": "Transcoding failed: invalid video format",
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

**Note:** Run this command repeatedly to check job status. The job will transition through statuses until it reaches `completed` or `failed`.

---

## 3. Direct Job Submission

Submit a transcoding job with an existing input URL (skip the upload step).

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

**Request Parameters:**
- `jobId` (optional): Custom job ID (UUID). If omitted, a new UUID is generated
- `inputUrl` (required): Full URL to the input video file
- `outputUrl` (required): Base path for output files (e.g., `"outputs/my-job"`)
- `preset` (optional): Transcoding preset - `"default"`, `"web-optimized"`, `"hls"`, or `"hls-adaptive"`. Defaults to `"default"`
- `outputQualities` (optional): Array of output quality strings
- `r2Config` (optional): R2 credentials for output storage. If omitted, uses default worker R2 config

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "machineId": "machine-abc123",
  "queuedAt": 1703516400000
}
```

**Note:** The job is immediately queued and a worker will be spawned if capacity is available.

---

## 4. Job Status Polling

Check the status of any job by its ID.

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/jobs/550e8400-e29b-41d4-a716-446655440000"
```

**Response:** See Step 3 of the Upload Flow section above for example responses.

**Job Status Flow:**
```
uploading → queued → pending → running → completed
                                      → failed
```

| Status | Description |
|--------|-------------|
| `uploading` | Presigned URL generated, waiting for upload. Automatically recovered if file is uploaded but event notification is delayed |
| `queued` | Upload complete, event received |
| `pending` | In job queue, waiting for worker |
| `running` | Worker processing |
| `completed` | Done, outputs available |
| `failed` | Error occurred |

---

## 5. System Stats

Get system statistics including active machines, pending jobs, and active jobs.

```bash
curl -X GET "https://tcoder.your-subdomain.workers.dev/api/stats"
```

**Response:**
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

**Response Fields:**
- `machines.activeMachines`: Number of currently active Fly.io machines
- `machines.maxMachines`: Maximum allowed concurrent machines (default: 5)
- `machines.capacityAvailable`: Whether new machines can be spawned
- `pendingJobs`: Number of jobs waiting in the queue
- `activeJobs`: Number of jobs currently being processed
- `activeJobIds`: Array of job IDs currently being processed

---

## 6. Webhook Endpoint

Receive job completion notifications (for testing webhook integration).

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

**Request Parameters:**
- `jobId` (required): Job ID
- `status` (required): `"completed"` or `"failed"`
- `inputUrl` (required): Full URL to the input file
- `outputs` (required): Array of output objects with `quality`, `url`, and `preset`
- `error` (optional): Error message if status is `"failed"`
- `duration` (optional): Processing duration in seconds

**Response:**
```json
{
  "received": true
}
```

**Note:** This endpoint is typically called by Fly.io workers, not by clients. It updates the job status in Redis and removes the job from the active jobs list.

---

## Error Responses

All endpoints may return error responses:

**404 Not Found:**
```json
{
  "error": "Job not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Invalid job data"
}
```

**400 Bad Request:**
```json
{
  "error": "Validation failed",
  "details": "..."
}
```

---

## Notes

- Presigned URLs expire after 1 hour (3600 seconds)
- Job status is retained for 24 hours after creation
- Maximum retries for failed jobs: 3
- Maximum concurrent machines: 5 (configurable)
- Rate limit: 1 request per second for Fly API operations
- Check job status periodically by running the GET job status command multiple times

### Automatic Recovery

The system includes automatic recovery for jobs stuck in `"uploading"` status:

- **Recovery Window**: If a file is uploaded but the R2 event notification is delayed or lost, the system will automatically detect and recover the job after the presigned URL expiry time plus a 5-minute buffer (approximately 65 minutes after job creation)
- **File Verification**: The recovery process checks if the file actually exists in R2 before transitioning the job to `"pending"` status
- **Failed Upload Handling**: Jobs that remain in `"uploading"` status for more than 2x the recovery threshold (approximately 2 hours) without a corresponding file in R2 will be automatically marked as `"failed"` with the error message "Upload never completed (file not found after extended wait)"
- **No Action Required**: This recovery happens automatically in the background - you don't need to take any action if a job appears stuck in `"uploading"` status

