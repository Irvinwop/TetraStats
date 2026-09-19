FROM oven/bun:1.3.10-alpine

WORKDIR /app

COPY tracker/package.json tracker/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tracker/src ./src
COPY build/web ./web

ENV TRACKER_HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    WEB_ROOT=/app/web \
    TRACK_USERNAME=Irvinwop

EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
