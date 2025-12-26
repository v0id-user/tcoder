# Base image with Bun runtime
FROM oven/bun:latest

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy workspace root files (needed for Bun workspace resolution)
COPY package.json bun.lock ./

# Copy workspace package that fly depends on
COPY packages/logger packages/logger/

# Copy fly package.json
COPY fly/package.json fly/

# Install dependencies (Bun will resolve workspace dependencies)
RUN bun install

# Copy fly application code
COPY fly/ fly/

# No EXPOSE - this is not a web server

# Set working directory to fly for execution
WORKDIR /app/fly

# Entry point for one-shot FFmpeg jobs
# Job parameters passed via environment variables
CMD ["bun", "run", "ffmpeg-worker/worker.ts"]

