# How to Test TCoder

A CLI-focused guide for testing the transcoding API locally.

## Prerequisites

1. **Setup environment:**
```bash
cp env.local.example .env
cp env.local.example .dev.vars
```

2. **Fill in R2 credentials** in both `.env` and `.dev.vars`:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`

3. **Start the service:**
```bash
bun run dev
```

The API will be available at `http://localhost:8787`

---

## Where to Find Test Videos

### Quick Test Videos (Recommended)

**Big Buck Bunny** (Blender Foundation - Free):
- Small test: https://download.blender.org/demo/movies/BBB/big_buck_bunny_720p_1mb.mp4 (~1MB)
- Full video: https://download.blender.org/demo/movies/BBB/ (various sizes)

**Sintel** (Blender Foundation):
- https://download.blender.org/demo/movies/Sintel/

**Sample Videos** (Pre-sized):
- https://sample-videos.com/
- Choose sizes: 1MB, 5MB, 10MB, etc.

### Generate Test Video

If you have `ffmpeg` installed:
```bash
ffmpeg -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 -pix_fmt yuv420p test-video.mp4
```

---

## Testing Workflow

### Step 1: Health Check

Verify the service is running:

```bash
curl http://localhost:8787/
```

**Expected response:**
```json
{
  "status": "ok",
  "service": "tcoder"
}
```

---

### Step 2: Check Status (Redis Connectivity)

Verify Redis connection:

```bash
curl http://localhost:8787/api/status
```

**Expected response:**
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

---

### Step 3: Request Presigned Upload URL

Request a presigned URL to upload your video:

```bash
curl -X POST "http://localhost:8787/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-video.mp4",
    "contentType": "video/mp4",
    "preset": "web-optimized",
    "outputQualities": ["720p"]
  }'
```

**Save the `jobId` and `uploadUrl` from the response.**

**Expected response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://xxx.r2.cloudflarestorage.com/tcoder-input/inputs/550e8400.../test-video.mp4?X-Amz-Algorithm=...",
  "expiresAt": 1703520000000,
  "inputKey": "inputs/550e8400-e29b-41d4-a716-446655440000/test-video.mp4"
}
```

---

### Step 4: Upload Video File

Upload your video using the presigned URL from Step 3:

```bash
curl -X PUT "<UPLOAD_URL_FROM_STEP_3>" \
  -H "Content-Type: video/mp4" \
  --data-binary @test-video.mp4
```

**Replace `<UPLOAD_URL_FROM_STEP_3>` with the actual `uploadUrl` from Step 3.**

**Note:** Replace `@test-video.mp4` with the path to your actual video file.

---

### Step 5: Check Job Status

Poll the job status until it completes:

```bash
curl "http://localhost:8787/api/jobs/<JOB_ID_FROM_STEP_3>"
```

**Replace `<JOB_ID_FROM_STEP_3>` with the `jobId` from Step 3.**

**Run this command repeatedly** (every 10-30 seconds) until status is `completed` or `failed`.

**Status flow:**
```
uploading → queued → pending → running → completed
                                      → failed
```

**Example response (running):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "machineId": "local-dev-worker",
  "outputs": null,
  "error": null,
  "timestamps": {
    "createdAt": 1703516400000,
    "uploadedAt": 1703516401000,
    "queuedAt": 1703516402000,
    "startedAt": 1703516403000
  },
  "filename": "test-video.mp4",
  "preset": "web-optimized"
}
```

**Example response (completed):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "machineId": "local-dev-worker",
  "outputs": [
    {
      "quality": "720p",
      "url": "https://xxx.r2.cloudflarestorage.com/tcoder-output/outputs/550e8400.../720p.mp4"
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
  "filename": "test-video.mp4",
  "preset": "web-optimized"
}
```

---

### Step 6: Check System Stats

View system statistics:

```bash
curl http://localhost:8787/api/stats
```

**Expected response:**
```json
{
  "machines": {
    "activeMachines": 1,
    "maxMachines": 5,
    "capacityAvailable": true
  },
  "pendingJobs": 0,
  "activeJobs": 1,
  "activeJobIds": [
    "550e8400-e29b-41d4-a716-446655440000"
  ]
}
```

---

## Additional Test Scenarios

### Test Multiple Output Qualities

Request multiple output qualities:

```bash
curl -X POST "http://localhost:8787/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-video.mp4",
    "preset": "web-optimized",
    "outputQualities": ["480p", "720p", "1080p"]
  }'
```

### Test Different Presets

Test HLS preset:

```bash
curl -X POST "http://localhost:8787/api/upload" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-video.mp4",
    "preset": "hls",
    "outputQualities": ["720p", "1080p"]
  }'
```

### Direct Job Submission (Skip Upload)

Submit a job with an existing input URL:

```bash
curl -X POST "http://localhost:8787/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "inputUrl": "https://example.com/video.mp4",
    "outputUrl": "outputs/my-job",
    "preset": "web-optimized",
    "outputQualities": ["720p"]
  }'
```

---

## Troubleshooting

### Service Not Responding

Check if Docker containers are running:
```bash
docker ps | grep tcoder
```

You should see:
- `tcoder-redis`
- `tcoder-redis-http`
- `tcoder-fly-worker`

### Check Worker Logs

View Docker worker logs:
```bash
docker logs tcoder-fly-worker
```

### Reset Redis Data

Clear all Redis data:
```bash
docker-compose down -v
```

Then restart:
```bash
bun run dev
```

### Test Redis Connection

Verify SRH proxy is working:
```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["PING"]'
```

Expected: `{"result":"PONG"}`

---

## Expected Processing Times

- **Small video (1-5MB):** ~30 seconds to 2 minutes
- **Medium video (50-100MB):** ~2-5 minutes
- **Large video (500MB+):** ~10-30 minutes

Processing time depends on:
- Video duration
- Video resolution
- Number of output qualities
- Preset complexity

---

## Notes

- Presigned URLs expire after 1 hour
- Job status is retained for 24 hours after creation
- Maximum concurrent machines: 5 (configurable)
- Jobs automatically recover from `uploading` status if file exists but event is delayed
- Check job status periodically by running the GET job status command multiple times

