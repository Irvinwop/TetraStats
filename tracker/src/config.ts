import { resolve } from "node:path";

export type ReplaySource = "auto" | "official" | "inoue";

export interface TrackerConfig {
  host: string;
  port: number;
  username: string;
  playerId?: string;
  streams: string[];
  pollIntervalMs: number;
  requestDelayMs: number;
  requestTimeoutMs: number;
  backfillMaxPages: number;
  processBatchSize: number;
  maxAnalysisAttempts: number;
  replayRetries: number;
  replaySource: ReplaySource;
  tetrioToken?: string;
  minomuncherUrl?: string;
  dataDir: string;
  databasePath: string;
}

function readInteger(
  name: string,
  fallback: number,
  minimum: number,
): number {
  const raw = Bun.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

function readReplaySource(): ReplaySource {
  const source = (Bun.env.REPLAY_SOURCE ?? "auto").trim().toLowerCase();
  if (source === "auto" || source === "official" || source === "inoue") {
    return source;
  }
  throw new Error("REPLAY_SOURCE must be auto, official, or inoue");
}

export function loadConfig(): TrackerConfig {
  const dataDir = resolve(Bun.env.DATA_DIR?.trim() || "./data");
  const username = Bun.env.TRACK_USERNAME?.trim() || "Irvinwop";
  const streams = (Bun.env.TRACK_STREAMS ?? "league,40l,blitz,zenith,zenithex")
    .split(",")
    .map((stream) => stream.trim().toLowerCase())
    .filter(Boolean);

  if (streams.length === 0) {
    throw new Error("TRACK_STREAMS must include at least one record stream");
  }

  return {
    host: Bun.env.TRACKER_HOST?.trim() || "127.0.0.1",
    port: readInteger("PORT", 8080, 1),
    username,
    playerId: Bun.env.TRACK_PLAYER_ID?.trim() || undefined,
    streams: [...new Set(streams)],
    pollIntervalMs: readInteger("POLL_INTERVAL_MS", 300_000, 30_000),
    requestDelayMs: readInteger("REQUEST_DELAY_MS", 1_100, 0),
    requestTimeoutMs: readInteger("REQUEST_TIMEOUT_MS", 30_000, 1_000),
    backfillMaxPages: readInteger("BACKFILL_MAX_PAGES", 100, 1),
    processBatchSize: readInteger("PROCESS_BATCH_SIZE", 25, 1),
    maxAnalysisAttempts: readInteger("MAX_ANALYSIS_ATTEMPTS", 8, 1),
    replayRetries: readInteger("REPLAY_RETRIES", 4, 1),
    replaySource: readReplaySource(),
    tetrioToken: Bun.env.TETRIO_TOKEN?.trim() || undefined,
    minomuncherUrl:
      Bun.env.MINOMUNCHER_URL === ""
        ? undefined
        : Bun.env.MINOMUNCHER_URL?.trim() || "https://minomuncher.com",
    dataDir,
    databasePath: resolve(
      Bun.env.DATABASE_PATH?.trim() || `${dataDir}/tetrastats.sqlite`,
    ),
  };
}
