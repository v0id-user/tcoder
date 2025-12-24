# Use the official Bun image as the base image
FROM oven/bun:latest

# Set the working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Expose the port that matches fly.toml internal_port
EXPOSE 8080

# Start the application
CMD ["bun", "run", "machines.ts"]

