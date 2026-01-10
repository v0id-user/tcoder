# TCoder

Video transcoding pipeline. Cloudflare Workers + R2 + Fly.io + Redis.

## Setup

```bash
bun install

# R2 + Queue
bunx wrangler r2 bucket create tcoder-input
bunx wrangler r2 bucket create tcoder-output
bunx wrangler queues create tcoder-events
bunx wrangler r2 bucket notification create tcoder-input --event-type object-create --queue tcoder-events

# Secrets
bunx wrangler secret bulk .env

# Fly secrets (from fly/)
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
bun run fly:first-launch  # first time
bun run deploy            # cloudflare worker
bun run fly:deploy        # fly image
```

## Scripts

```bash
bun run dev
bun run deploy
bun run fly:deploy
bun run fly:logs
bun run test
```

## Docs

- [API Reference](./USAGE.md)
- [Local Dev](./LOCAL_DEV.md)
- [Fly Workers](./fly/README.md)
- [SDK](./packages/tcoder-client/README.md)
