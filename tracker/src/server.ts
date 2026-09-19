import { extname, join, normalize } from "node:path";
import type { TrackerConfig } from "./config.ts";
import type { TrackerDatabase } from "./database.ts";
import { processReplay } from "./processor.ts";
import type { IrvinTracker } from "./tracker.ts";
import { ReplayProcessingError } from "./types.ts";

const publicDirectory = join(import.meta.dir, "..", "public");

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

function numberParam(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : fallback;
}

function contentType(path: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    }[extname(path)] ?? "application/octet-stream"
  );
}

function staticResponse(pathname: string): Response {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(publicDirectory, safePath);
  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "Content-Type": contentType(path),
      "Cache-Control": safePath === "index.html" ? "no-cache" : "public, max-age=300",
    },
  });
}

export function startServer(
  config: TrackerConfig,
  database: TrackerDatabase,
  tracker: IrvinTracker,
) {
  return Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          username: config.username,
          database: config.databasePath,
          tracker: tracker.status,
          replaySource: config.replaySource,
          officialReplayAccess: Boolean(config.tetrioToken),
        });
      }

      if (url.pathname === "/api/summary" && request.method === "GET") {
        return json({
          player: tracker.playerSnapshot,
          tracker: tracker.status,
          stats: database.getSummary(),
        });
      }

      if (url.pathname === "/api/games" && request.method === "GET") {
        const limit = numberParam(url.searchParams.get("limit"), 50, 500);
        const offset = numberParam(url.searchParams.get("offset"), 0, 1_000_000);
        return json({
          records: database.listRecords({
            limit,
            offset,
            stream: url.searchParams.get("stream") || undefined,
            status: url.searchParams.get("status") || undefined,
          }),
          limit,
          offset,
        });
      }

      if (url.pathname.startsWith("/api/games/") && request.method === "GET") {
        const id = decodeURIComponent(url.pathname.slice("/api/games/".length));
        const record = database.getRecord(id);
        return record ? json(record) : json({ error: "record_not_found" }, 404);
      }

      if (url.pathname === "/api/export" && request.method === "GET") {
        return json(database.exportAll());
      }

      if (url.pathname === "/api/sync" && request.method === "POST") {
        if (tracker.status.running) {
          return json({ accepted: false, reason: "sync_already_running" }, 409);
        }
        void tracker.triggerSync("api").catch(() => undefined);
        return json({ accepted: true }, 202);
      }

      if (url.pathname === "/api/process-replay" && request.method === "POST") {
        const contentLength = Number.parseInt(
          request.headers.get("content-length") ?? "0",
          10,
        );
        if (contentLength > 50 * 1024 * 1024) {
          return json({ error: "replay_too_large" }, 413);
        }
        try {
          const result = processReplay(
            await request.text(),
            config.playerId ?? "",
            config.username,
          );
          return json(result.analysis);
        } catch (error) {
          if (error instanceof ReplayProcessingError) {
            return json({ error: error.code, message: error.message }, 422);
          }
          return json(
            {
              error: "processor_failed",
              message: error instanceof Error ? error.message : String(error),
            },
            500,
          );
        }
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "not_found" }, 404);
      }

      return staticResponse(url.pathname);
    },
  });
}
