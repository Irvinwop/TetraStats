import type { TrackerConfig } from "./config.ts";
import {
  TetrioHttpError,
  type RecordsPage,
  type TetrioPlayer,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TetrioClient {
  constructor(private readonly config: TrackerConfig) {}

  private async request(
    endpoint: string,
    init: RequestInit = {},
    attempts = 3,
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          ...init,
          headers: {
            Accept: "application/json",
            "User-Agent": "TetraStats-Local-Tracker/1.0",
            ...init.headers,
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        if (response.ok) return response;

        const message = (await response.text()).slice(0, 500);
        if (
          attempt < attempts &&
          (response.status === 429 || response.status >= 500)
        ) {
          await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));
          continue;
        }
        throw new TetrioHttpError(
          `${response.status} ${response.statusText}: ${message}`,
          response.status,
          endpoint,
        );
      } catch (error) {
        if (error instanceof TetrioHttpError) throw error;
        lastError = error;
        if (attempt < attempts) {
          await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));
        }
      }
    }
    throw new Error(
      `Request failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async requestJson(endpoint: string): Promise<JsonObject> {
    const response = await this.request(endpoint);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(
        `TETR.IO returned invalid JSON for ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isObject(payload)) throw new Error(`Unexpected response from ${endpoint}`);
    if (payload.success !== true) {
      throw new Error(`TETR.IO rejected ${endpoint}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  async getPlayer(username: string): Promise<TetrioPlayer> {
    const endpoint = `https://ch.tetr.io/api/users/${encodeURIComponent(username.toLowerCase())}`;
    const payload = await this.requestJson(endpoint);
    if (!isObject(payload.data)) throw new Error("Player response is missing data");
    if (typeof payload.data._id !== "string" || typeof payload.data.username !== "string") {
      throw new Error("Player response is missing an id or username");
    }
    return payload.data as TetrioPlayer;
  }

  async getRecords(
    username: string,
    stream: string,
    after?: string,
  ): Promise<RecordsPage> {
    const url = new URL(
      `https://ch.tetr.io/api/users/${encodeURIComponent(username.toLowerCase())}/records/${encodeURIComponent(stream)}/recent`,
    );
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const payload = await this.requestJson(url.toString());
    if (!isObject(payload.data) || !Array.isArray(payload.data.entries)) {
      throw new Error(`Record stream ${stream} is missing entries`);
    }
    const cache = isObject(payload.cache) ? payload.cache : undefined;
    return {
      entries: payload.data.entries,
      cachedUntil:
        cache && typeof cache.cached_until === "number"
          ? cache.cached_until
          : undefined,
    };
  }

  private async downloadOfficialReplay(replayId: string): Promise<string> {
    if (!this.config.tetrioToken) {
      throw new Error("TETRIO_TOKEN is required for the official replay source");
    }
    const endpoint = `https://tetr.io/api/games/${encodeURIComponent(replayId)}`;
    const response = await this.request(
      endpoint,
      {
        headers: { Authorization: `Bearer ${this.config.tetrioToken}` },
      },
      this.config.replayRetries,
    );
    const payload: unknown = await response.json();
    if (!isObject(payload) || payload.success !== true || !isObject(payload.game)) {
      throw new Error("Official replay response is missing game data");
    }
    return JSON.stringify(payload.game);
  }

  private async downloadInoueReplay(replayId: string): Promise<string> {
    const endpoint = `https://inoue.szy.lol/api/replay/${encodeURIComponent(replayId)}`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.replayRetries; attempt += 1) {
      try {
        const response = await this.request(
          `${endpoint}?attempt=${attempt}`,
          { headers: { Connection: "close" } },
          1,
        );
        const body = await response.text();
        const parsed: unknown = JSON.parse(body);
        if (!isObject(parsed)) throw new Error("Replay JSON is not an object");
        return body;
      } catch (error) {
        if (error instanceof TetrioHttpError && error.status === 404) {
          throw error;
        }
        lastError = error;
        if (attempt < this.config.replayRetries) {
          await sleep(Math.min(10_000, 750 * 2 ** (attempt - 1)));
        }
      }
    }
    throw new Error(
      `Inoue replay download failed after ${this.config.replayRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  async downloadReplay(replayId: string): Promise<string> {
    if (this.config.replaySource === "official") {
      return this.downloadOfficialReplay(replayId);
    }
    if (this.config.replaySource === "inoue") {
      return this.downloadInoueReplay(replayId);
    }

    if (this.config.tetrioToken) {
      try {
        return await this.downloadOfficialReplay(replayId);
      } catch (error) {
        console.warn(
          `[tracker] official replay download failed for ${replayId}; trying Inoue:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return this.downloadInoueReplay(replayId);
  }

  async getMinomuncherAnalysis(replayId: string): Promise<JsonObject> {
    if (!this.config.minomuncherUrl) {
      throw new Error("MINOMUNCHER_URL is disabled");
    }
    const endpoint = new URL(
      `/api/replay/${encodeURIComponent(replayId)}`,
      this.config.minomuncherUrl,
    ).toString();
    const response = await this.request(
      endpoint,
      {},
      this.config.replayRetries,
    );
    const payload: unknown = await response.json();
    if (!isObject(payload) || Object.keys(payload).length === 0) {
      throw new Error("MinoMuncher returned no player statistics");
    }
    if (typeof payload.message === "string" && Object.keys(payload).length === 1) {
      throw new Error(`MinoMuncher rejected replay: ${payload.message}`);
    }
    return payload;
  }
}
