# tcoder-client

Type-safe SDK for video transcoding. Automates the workflow of uploading videos and checking transcoding job status.

## Installation

```bash
bun add tcoder-client effect
```

## Usage

### Basic Example

```typescript
import { TcoderClient } from "tcoder-client";
import { Effect } from "effect";

const client = new TcoderClient("http://localhost:8787");

// Upload a video file
const result = await Effect.runPromise(
  client.upload(videoBlob, {
    filename: "video.mp4",
    contentType: "video/mp4",
    preset: "default",
    outputQualities: ["144p", "360p", "720p"],
  })
);

console.log(`Job ID: ${result.jobId}`);
console.log(`Status: ${result.status}`);

// Check job status
const status = await Effect.runPromise(
  client.getStatus(result.jobId)
);

console.log(`Current status: ${status.status}`);
if (status.status === "completed" && status.outputs) {
  console.log("Outputs:", status.outputs);
}
```

### With Error Handling

```typescript
import { TcoderClient, UploadError, StatusError } from "tcoder-client";
import { Effect } from "effect";

const client = new TcoderClient({ baseUrl: "http://localhost:8787" });

const program = Effect.gen(function* () {
  // Upload file
  const uploadResult = yield* client.upload(videoBlob, {
    filename: "video.mp4",
    contentType: "video/mp4",
  });

  // Poll for completion
  let status = yield* client.getStatus(uploadResult.jobId);

  while (status.status !== "completed" && status.status !== "failed") {
    yield* Effect.sleep("2 seconds");
    status = yield* client.getStatus(uploadResult.jobId);
  }

  return status;
}).pipe(
  Effect.catchTag("UploadError", (error) =>
    Effect.fail(new Error(`Upload failed: ${error.message}`))
  ),
  Effect.catchTag("StatusError", (error) =>
    Effect.fail(new Error(`Status check failed: ${error.message}`))
  )
);

const result = await Effect.runPromise(program);
```

### Configuration Options

```typescript
// Simple string URL
const client1 = new TcoderClient("http://localhost:8787");

// With configuration object
const client2 = new TcoderClient({
  baseUrl: "http://localhost:8787",
  options: {
    headers: {
      Authorization: "Bearer token",
    },
    credentials: "include",
  },
});
```

### Upload Options

- `filename` (required): Original filename
- `contentType` (optional): MIME type (default: "video/mp4")
- `preset` (optional): Transcoding preset - "default" | "web-optimized" | "hls" | "hls-adaptive" (default: "default")
- `outputQualities` (optional): Array of quality levels - `["144p", "360p", "720p"]`. When specified, the transcoder will generate separate output files for each quality with appropriate resolution and bitrate settings.

### Quality Options

The SDK supports three quality levels:

- **144p**: Low quality - 256x144 resolution, 100k video bitrate, 64k audio bitrate
- **360p**: Medium quality - 640x360 resolution, 400k video bitrate, 96k audio bitrate  
- **720p**: High quality - 1280x720 resolution, 1500k video bitrate, 128k audio bitrate

When you specify `outputQualities`, the transcoder will:
1. Download the input video once
2. Generate separate transcoded outputs for each requested quality
3. Upload each output with a quality suffix (e.g., `outputs/job-123-144p.mp4`, `outputs/job-123-360p.mp4`)

Example:
```typescript
const result = await Effect.runPromise(
  client.upload(videoBlob, {
    filename: "video.mp4",
    outputQualities: ["144p", "360p", "720p"], // Generate all three qualities
  })
);

// When completed, status.outputs will contain:
// [
//   { quality: "144p", url: "https://..." },
//   { quality: "360p", url: "https://..." },
//   { quality: "720p", url: "https://..." }
// ]
```

### Job Status

The `getStatus()` method returns a `JobStatus` object with:
- `jobId`: Job identifier
- `status`: Current status - "uploading" | "queued" | "pending" | "running" | "completed" | "failed"
- `machineId`: Machine processing the job (if running)
- `outputs`: Array of transcoded outputs (when completed)
- `error`: Error message (if failed)
- `timestamps`: Job lifecycle timestamps
- `filename`: Original filename
- `preset`: Transcoding preset used

## Architecture

The SDK automates the following workflow:

1. **Request Upload URL**: Calls `POST /api/upload` to get a presigned R2 upload URL
2. **Upload to R2**: Uploads the file directly to R2 storage using the presigned URL
3. **Track Status**: Uses `GET /api/jobs/:jobId` to check job status

All operations use Effect for type-safe error handling and async operations.
