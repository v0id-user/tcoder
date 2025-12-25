# Base image with Bun runtime
FROM oven/bun:latest

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files for dependency caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy application code
COPY . .

# No EXPOSE - this is not a web server

# Entry point for one-shot FFmpeg jobs
# Job parameters passed via environment variables
CMD ["bun", "run", "ffmpeg-worker/worker.ts"]

