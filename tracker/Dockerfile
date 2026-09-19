FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY public ./public

ENV TRACKER_HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    TRACK_USERNAME=Irvinwop

EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
