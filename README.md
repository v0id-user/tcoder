# TCoder

Experimental side project for learning about serverless media transcoding pipelines. This is purely for experience and understanding how event-driven architectures work in practice.

## What This Is

A serverless video transcoding pipeline that handles upload, processing, and distribution. The system is event-driven - components react to events rather than polling, which keeps things efficient and scalable.

## First Launch

Set up Fly.io infrastructure for transcoding workers:

```bash
bun run fly:first-launch
```

This command:
1. Authenticates with Fly.io (opens browser for login)
2. Creates the app if it doesn't exist
3. Builds the Docker image with FFmpeg and Bun
4. Pushes the image to Fly.io registry

After first launch, use `bun run fly:deploy` to rebuild and push updated images.

## Architecture

The pipeline consists of five phases:

**1. Authorization Phase**
- Client requests upload permission from the Worker API
- Worker generates a presigned PUT URL from R2 storage
- Client receives the URL for direct upload

**2. Ingestion Phase**
- Client uploads raw video directly to R2 storage
- R2 sends an event notification to the Worker when the object is created

**3. Processing Phase**
- Worker triggers a transcoding job on a Fly.io machine
- Fly.io downloads the raw video from R2
- Multiple quality versions are generated (480p, 720p, 1080p)
- Processed videos are uploaded back to R2

**4. Discoverability Phase**
- Fly.io sends a webhook to the Worker when processing completes
- Worker updates video status in the database
- Client is notified via push notification or WebSocket that the video is ready

**5. Distribution Phase**
- Client requests video via CDN URL
- Bunny CDN serves cached content or fetches from R2 origin if needed
- Video streams to the client

## Infrastructure

- **Cloudflare Worker**: API layer handling authorization, event routing, and notifications
- **Cloudflare R2**: Object storage for raw and transcoded video files
- **Fly.io**: Compute infrastructure for video transcoding workloads
- **Bunny CDN**: Content delivery network for video distribution

![Event-Driven Serverless Transcoding Pipeline](./design/architecture/Event-Driven%20Serverless%20Transcoding%20Pipeline.png)

## Fly.io Setup

For detailed information about the Fly.io ephemeral worker setup, configuration, and usage, see [fly/README.md](./fly/README.md).

The Fly.io workers use an ephemeral design where:
- Each transcoding job gets its own machine
- Machines start on-demand and stop when the job completes
- Zero idle cost - you only pay for execution time
- Perfect for batch processing workloads

See the [Fly.io README](./fly/README.md) for deployment instructions, cost analysis, and integration examples.
