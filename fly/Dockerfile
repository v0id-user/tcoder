FROM oven/bun:latest

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./

COPY packages/logger packages/logger/

COPY fly/package.json fly/package.json

RUN bun install

COPY fly/ fly/

WORKDIR /app/fly

CMD ["bun", "run", "ffmpeg-worker/worker.ts"]

