# tcoder-client

```bash
bun add tcoder-client effect
```

## Usage

```typescript
import { TcoderClient } from "tcoder-client";
import { Effect } from "effect";

const client = new TcoderClient("http://localhost:8787");

const result = await Effect.runPromise(
  client.upload(videoBlob, {
    filename: "video.mp4",
    preset: "web-optimized",
    outputQualities: ["720p", "1080p"],
  })
);

const status = await Effect.runPromise(client.getStatus(result.jobId));
```

## Config

```typescript
const client = new TcoderClient({
  baseUrl: "http://localhost:8787",
  options: {
    headers: { Authorization: "Bearer token" },
  },
});
```

## Upload Options

- `filename` (required)
- `contentType` (default: `video/mp4`)
- `preset`: `default` | `web-optimized` | `hls` | `hls-adaptive`
- `outputQualities`: `["480p", "720p", "1080p"]`
