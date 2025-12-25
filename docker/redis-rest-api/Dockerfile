FROM golang:1.21-alpine AS builder

# Install git and build dependencies
RUN apk add --no-cache git

# Clone and build upstash-redis-local
WORKDIR /build
RUN git clone https://github.com/DarthBenro008/upstash-redis-local.git . && \
    go build -o upstash-redis-local .

FROM alpine:latest

RUN apk add --no-cache ca-certificates wget netcat-openbsd

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /build/upstash-redis-local /app/upstash-redis-local

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

# Default values can be overridden via environment variables
ENV UPSTASH_TOKEN=local-dev-token
ENV UPSTASH_ADDR=:8080
ENV REDIS_ADDR=redis:6379

ENTRYPOINT ["/app/entrypoint.sh"]

