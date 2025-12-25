#!/bin/sh
set -e

# Default values
UPSTASH_TOKEN=${UPSTASH_TOKEN:-local-dev-token}
UPSTASH_ADDR=${UPSTASH_ADDR:-:8080}
REDIS_ADDR=${REDIS_ADDR:-redis:6379}

exec /app/upstash-redis-local \
  --token "${UPSTASH_TOKEN}" \
  --addr "${UPSTASH_ADDR}" \
  --redis "${REDIS_ADDR}"

