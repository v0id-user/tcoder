# How to Test TCoder

A CLI-focused guide for testing the transcoding API locally.

---

## Python Script (Recommended - Fully Automatic)

The easiest way to test TCoder locally is using the provided Python script, which automates the entire workflow.

### Prerequisites

1. **Python 3.7+** (uses only standard library, no dependencies)
2. **Services running** (see Prerequisites section below)

### Usage

The script automatically handles:
1. Requesting presigned upload URL
2. Uploading video file to R2
3. Manually triggering R2 event processing (dev mode only)
4. Polling for job completion

**Basic usage:**
```bash
python scripts/client_flow.py video.mp4
```

**With options:**
```bash
python scripts/client_flow.py video.mp4 \
  --preset web-optimized \
  --qualities 720p 1080p \
  --base-url http://localhost:8787
```

**Full options:**
```bash
python scripts/client_flow.py video.mp4 \
  --base-url http://localhost:8787 \
  --preset web-optimized \
  --qualities 720p 1080p \
  --content-type video/mp4 \
  --poll-interval 5 \
  --max-wait 3600
```

### Options

- `video_file` (required): Path to video file to transcode
- `--base-url`: API server URL (default: `http://localhost:8787`)
- `--preset`: Transcoding preset - `default`, `web-optimized`, `hls`, or `hls-adaptive` (default: `default`)
- `--qualities`: Output qualities, e.g., `720p 1080p` (optional)
- `--content-type`: Content type (default: `video/mp4`)
- `--poll-interval`: Poll interval in seconds (default: `5`)
- `--max-wait`: Maximum wait time in seconds (default: no limit)

### Example Output

```
📤 Requesting upload URL for video.mp4...
✅ Upload URL received. Job ID: 550e8400-e29b-41d4-a716-446655440000
📤 Uploading video.mp4 to R2...
✅ Upload complete!
🔔 Triggering R2 event processing for job 550e8400-e29b-41d4-a716-446655440000...
✅ Job queued for processing. Status: pending
🔍 Polling job 550e8400-e29b-41d4-a716-446655440000...
   Poll interval: 5s
   [0s] Status: pending
   [5s] Status: running
   [45s] Status: completed
✅ Job completed successfully!

📦 Outputs:
   • 720p: https://xxx.r2.cloudflarestorage.com/outputs/550e8400.../720p.mp4
   • 1080p: https://xxx.r2.cloudflarestorage.com/outputs/550e8400.../1080p.mp4

⏱️  Timestamps:
   Created: 2023-12-25 12:00:00
   Uploaded: 2023-12-25 12:00:01
   Queued: 2023-12-25 12:00:01
   Started: 2023-12-25 12:00:05
   Completed: 2023-12-25 12:00:45
   Duration: 40.0s
```

### Notes

- The script uses only Python standard library (no `pip install` required)
- The R2 event trigger endpoint (`/api/jobs/:jobId/trigger-r2-event`) is **dev mode only** and will return 404 in production
- The script automatically handles the complete workflow from upload to completion
- Press `Ctrl+C` to interrupt polling at any time

---

## Prerequisites

1. **Setup environment:**
```bash
cp env.local.example .env
cp env.local.example .dev.vars
```

2. **Fill in R2 credentials** in both `.env` and `.dev.vars`:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID` (must have READ access to input bucket, WRITE to output bucket)
   - `R2_SECRET_ACCESS_KEY`

3. **Start the service:**
```bash
bun run dev
```

The API will be available at `http://localhost:8787`

---

## Important: Local Testing Limitations

### Why Upload Flow Doesn't Work Locally

The **upload flow** (`POST /api/upload`) relies on R2 event notifications to transition jobs from "uploading" to "pending" status. In local development:

- R2 events are **not delivered** to the local wrangler dev server
- Jobs will stay stuck in "uploading" status forever
- The recovery cron only runs every 65 minutes

### Solution: Use Direct Job Submission

For local testing, use the **direct job submission** endpoint (`POST /api/jobs`) which:
- Bypasses the R2 event system entirely
- Immediately queues jobs as "pending"
- Works reliably in local development

---

## Quick Start (Local Testing - Recommended)

### Step 1: Verify Services Are Running

```bash
curl http://localhost:8787/api/status
```

You should see `"redis": {"connected": true}`.

### Step 2: Upload a Video to R2 Manually

First, upload a test video to your R2 INPUT bucket. You can do this via:
- Cloudflare Dashboard > R2 > Your Bucket > Upload
- Or use the presigned URL flow (just the upload part)

Note the full R2 URL of your uploaded video, e.g.:
```
https://tcoder-input.<ACCOUNT_ID>.r2.cloudflarestorage.com/test-videos/sample.mp4
```

### Step 3: Submit Job Directly (Bypasses R2 Events)

```bash
curl -X POST "http://localhost:8787/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "inputUrl": "https://tcoder-input.<ACCOUNT_ID>.r2.cloudflarestorage.com/test-videos/sample.mp4",
    "outputUrl": "outputs/test-job",
    "preset": "web-optimized",
    "outputQualities": ["720p"]
  }'
```

**Replace `<ACCOUNT_ID>` with your actual Cloudflare account ID.**

**Expected response:**
```json
{
  "jobId": "abc123-...",
  "status": "pending",
  "machineId": null,
  "queuedAt": 1703510400000
}
```

**Save the `jobId` for the next step.**

### Step 4: Check Job Status

```bash
curl "http://localhost:8787/api/jobs/<JOB_ID>"
```

Poll this endpoint every 10-30 seconds until status is `completed` or `failed`.

**Status flow:**
```
pending → running → completed
                 → failed
```

### Step 5: Check Worker Logs

If the job isn't processing, check the worker logs:

```bash
docker logs tcoder-fly-worker -f
```

You should see the worker picking up the job and processing it.

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

### Upload Test Video to R2

1. Download a test video:
```bash
curl -o test-video.mp4 "https://download.blender.org/demo/movies/BBB/big_buck_bunny_720p_1mb.mp4"
```

2. Upload to R2 via Cloudflare Dashboard:
   - Go to Cloudflare Dashboard > R2
   - Select your INPUT bucket (e.g., `tcoder-input`)
   - Click "Upload" and select your video
   - Note the object path (e.g., `test-videos/test-video.mp4`)

3. Construct the full URL:
```
https://<BUCKET_NAME>.<ACCOUNT_ID>.r2.cloudflarestorage.com/<OBJECT_PATH>
```

---

## Full Upload Flow (Works in Production, Limited Locally)

> **Note:** This flow relies on R2 events which don't work locally.
> Use the "Quick Start" section above for local testing.

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

**Status flow (upload flow):**
```
uploading → queued → pending → running → completed
                                      → failed
```

> **Local Issue:** Jobs will stay in "uploading" status because R2 events don't trigger locally.
> Use the direct job submission flow instead.

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

## Queue Verification

### Check Pending Jobs Queue

To verify jobs are being queued correctly, you can check Redis directly:

```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["ZRANGE", "jobs:pending", "0", "-1"]'
```

This shows all job IDs in the pending queue.

### Check Job Status in Redis

```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["HGETALL", "jobs:status:<JOB_ID>"]'
```

Replace `<JOB_ID>` with your actual job ID.

### Check Active Machines

```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["HGETALL", "machines:pool"]'
```

---

## Additional Test Scenarios

### Test Multiple Output Qualities

Request multiple output qualities:

```bash
curl -X POST "http://localhost:8787/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "inputUrl": "https://tcoder-input.<ACCOUNT_ID>.r2.cloudflarestorage.com/test-videos/sample.mp4",
    "outputUrl": "outputs/multi-quality-test",
    "preset": "web-optimized",
    "outputQualities": ["480p", "720p", "1080p"]
  }'
```

### Test Different Presets

Test HLS preset:

```bash
curl -X POST "http://localhost:8787/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "inputUrl": "https://tcoder-input.<ACCOUNT_ID>.r2.cloudflarestorage.com/test-videos/sample.mp4",
    "outputUrl": "outputs/hls-test",
    "preset": "hls",
    "outputQualities": ["720p", "1080p"]
  }'
```

---

## Troubleshooting

### Job Stuck in "uploading" Status

**Cause:** R2 events don't work locally.

**Solution:** Use direct job submission (`POST /api/jobs`) instead of the upload flow.

### Job Stuck in "pending" Status

**Cause:** Worker not picking up jobs.

**Check:**
1. Is the worker running?
```bash
docker ps | grep tcoder-fly-worker
```

2. Check worker logs:
```bash
docker logs tcoder-fly-worker -f
```

3. Is the job in the queue?
```bash
curl -X POST http://localhost:8079 \
  -H "Authorization: Bearer local_dev_token" \
  -H "Content-Type: application/json" \
  -d '["ZRANGE", "jobs:pending", "0", "-1"]'
```

### R2 Access Denied Error

**Cause:** R2 credentials don't have proper permissions.

**Check:**
1. Verify credentials in `.env` file
2. Ensure API token has:
   - READ access to INPUT bucket
   - WRITE access to OUTPUT bucket

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

- **Local testing:** Use `POST /api/jobs` (direct submission) - the upload flow requires R2 events
- Presigned URLs expire after 1 hour
- Job status is retained for 24 hours after creation
- Maximum concurrent machines: 5 (configurable)
- The worker polls `jobs:pending` queue every 5 seconds
- Check job status periodically by running the GET job status command multiple times
