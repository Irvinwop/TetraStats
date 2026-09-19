import { describe, expect, test } from "bun:test";
import {
  isFirstPartyProxyPath,
  proxyFirstPartyRequest,
  resolveFirstPartyUpstreamUrl,
} from "../src/server.ts";

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
});
