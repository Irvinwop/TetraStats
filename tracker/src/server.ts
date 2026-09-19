import { extname, join, normalize, resolve } from "node:path";
import type { TrackerConfig } from "./config.ts";
import type { TrackerDatabase } from "./database.ts";
import { processReplay } from "./processor.ts";
import type { IrvinTracker } from "./tracker.ts";
import { ReplayProcessingError, TetrioHttpError } from "./types.ts";

const publicDirectory = resolve(
  Bun.env.WEB_ROOT?.trim() ||
    join(import.meta.dir, "..", "..", "build", "web"),
);
const defaultFirstPartyUpstreamOrigin = "https://ts.dan63.by";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

export function isFirstPartyProxyPath(pathname: string): boolean {
  return (
    pathname === "/oskware_bridge.php" ||
    pathname.startsWith("/beanserver_blaster/")
  );
}

export function resolveFirstPartyUpstreamUrl(
  requestUrl: URL,
  upstreamOrigin =
    Bun.env.TETRASTATS_UPSTREAM_ORIGIN?.trim() ||
    defaultFirstPartyUpstreamOrigin,
): URL {
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, upstreamOrigin);
}

export async function proxyFirstPartyRequest(
  request: Request,
  requestUrl: URL,
  fetcher: FetchLike = fetch,
  upstreamOrigin?: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const requestHeaders = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  try {
    const upstreamResponse = await fetcher(
      resolveFirstPartyUpstreamUrl(requestUrl, upstreamOrigin),
      {
        method,
        headers: requestHeaders,
        body:
          method === "GET" || method === "HEAD"
            ? undefined
            : await request.arrayBuffer(),
      },
    );
    const responseHeaders = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    for (const name of [
      "cache-control",
      "content-disposition",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = upstreamResponse.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return json(
      {
        error: "upstream_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}

export async function replayAnalysisResponse(
  replayId: string,
  database: TrackerDatabase,
  fetchAnalysis: (replayId: string) => Promise<Record<string, unknown>>,
): Promise<Response> {
  const cached = database.getReplayAnalysis(replayId);
  if (cached) return json(cached);

  try {
    return json(await fetchAnalysis(replayId));
  } catch (error) {
    const status =
      error instanceof TetrioHttpError &&
      [400, 404, 422, 429].includes(error.status)
        ? error.status
        : 502;
    return json(
      {
        error: "replay_analysis_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      status,
    );
  }
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
      ".wasm": "application/wasm",
      ".ttf": "font/ttf",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ico": "image/x-icon",
    }[extname(path)] ?? "application/octet-stream"
  );
}

async function staticResponse(pathname: string): Promise<Response> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  let path = join(publicDirectory, safePath);
  let file = Bun.file(path);
  if (!(await file.exists())) {
    path = join(publicDirectory, "index.html");
    file = Bun.file(path);
  }
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

      if (isFirstPartyProxyPath(url.pathname)) {
        if (!["GET", "HEAD", "POST"].includes(request.method)) {
          return json({ error: "method_not_allowed" }, 405);
        }
        return await proxyFirstPartyRequest(request, url);
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

      if (
        url.pathname.startsWith("/api/replay-analysis/") &&
        request.method === "GET"
      ) {
        let replayId: string;
        try {
          replayId = decodeURIComponent(
            url.pathname.slice("/api/replay-analysis/".length),
          );
        } catch {
          return json({ error: "invalid_replay_id" }, 400);
        }
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(replayId)) {
          return json({ error: "invalid_replay_id" }, 400);
        }
        return await replayAnalysisResponse(
          replayId,
          database,
          (id) => tracker.client.getMinomuncherAnalysis(id),
        );
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

      return await staticResponse(url.pathname);
    },
  });
}
