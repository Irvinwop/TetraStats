import { describe, expect, test } from "bun:test";
import {
  isFirstPartyProxyPath,
  proxyFirstPartyRequest,
  replayAnalysisResponse,
  resolveFirstPartyUpstreamUrl,
} from "../src/server.ts";
import { TrackerDatabase } from "../src/database.ts";

describe("local TetraStats links", () => {
  test("recognizes only the first-party proxy routes", () => {
    expect(isFirstPartyProxyPath("/oskware_bridge.php")).toBe(true);
    expect(isFirstPartyProxyPath("/beanserver_blaster/cutoffs.json")).toBe(
      true,
    );
    expect(isFirstPartyProxyPath("/api/summary")).toBe(false);
  });

  test("maps local paths to the upstream service", () => {
    const requestUrl = new URL(
      "http://127.0.0.1:8080/oskware_bridge.php?endpoint=tetrioUser&user=Irvinwop",
    );

    expect(
      resolveFirstPartyUpstreamUrl(
        requestUrl,
        "https://upstream.example",
      ).toString(),
    ).toBe(
      "https://upstream.example/oskware_bridge.php?endpoint=tetrioUser&user=Irvinwop",
    );
  });

  test("forwards method, body, and response metadata", async () => {
    let forwardedUrl = "";
    let forwardedMethod = "";
    let forwardedBody = "";
    const request = new Request(
      "http://127.0.0.1:8080/oskware_bridge.php?endpoint=Minomuncher",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"replay":true}',
      },
    );

    const response = await proxyFirstPartyRequest(
      request,
      new URL(request.url),
      async (input, init) => {
        forwardedUrl = input.toString();
        forwardedMethod = init?.method ?? "";
        forwardedBody = await new Response(init?.body).text();
        return new Response('{"ok":true}', {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      },
      "https://upstream.example",
    );

    expect(forwardedUrl).toBe(
      "https://upstream.example/oskware_bridge.php?endpoint=Minomuncher",
    );
    expect(forwardedMethod).toBe("POST");
    expect(forwardedBody).toBe('{"replay":true}');
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("serves cached replay analysis without calling upstream", async () => {
    const database = new TrackerDatabase(":memory:");
    try {
      database.upsertRecord({
        id: "game-1",
        replayId: "replay-1",
        stream: "league",
        playedAt: "2026-09-19T00:00:00.000Z",
        mode: "league",
        stub: false,
        rawJson: "{}",
      });
      database.markProcessed(
        "game-1",
        "{}",
        { player: { username: "Irvinwop" } },
      );
      let upstreamCalls = 0;

      const response = await replayAnalysisResponse(
        "replay-1",
        database,
        async () => {
          upstreamCalls += 1;
          return {};
        },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        player: { username: "Irvinwop" },
      });
      expect(upstreamCalls).toBe(0);
    } finally {
      database.close();
    }
  });

  test("fetches replay analysis when it is not cached", async () => {
    const database = new TrackerDatabase(":memory:");
    try {
      const response = await replayAnalysisResponse(
        "replay-2",
        database,
        async (replayId) => ({ replayId, source: "upstream" }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        replayId: "replay-2",
        source: "upstream",
      });
    } finally {
      database.close();
    }
  });

  test("does not send known non-League replays to MinoMuncher", async () => {
    const database = new TrackerDatabase(":memory:");
    try {
      database.upsertRecord({
        id: "sprint-1",
        replayId: "solo-replay",
        stream: "40l",
        playedAt: "2026-09-19T00:00:00.000Z",
        mode: "40l",
        stub: false,
        rawJson: "{}",
      });
      let upstreamCalls = 0;

      const response = await replayAnalysisResponse(
        "solo-replay",
        database,
        async () => {
          upstreamCalls += 1;
          return {};
        },
      );

      expect(response.status).toBe(422);
      expect(upstreamCalls).toBe(0);
    } finally {
      database.close();
    }
  });
});
