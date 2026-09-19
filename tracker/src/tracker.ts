import type { TrackerConfig } from "./config.ts";
import { TrackerDatabase } from "./database.ts";
import { findPlayerAnalysis, processReplay } from "./processor.ts";
import { sleep, TetrioClient } from "./tetrio.ts";
import {
  ReplayProcessingError,
  TetrioHttpError,
  type StoredRecordInput,
  type TetrioPlayer,
  type TetrioRecord,
  type TrackerRuntimeStatus,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cursorToString(cursor: unknown): string | undefined {
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  const value = cursor as JsonObject;
  const pri = numeric(value.pri);
  const sec = numeric(value.sec);
  const ter = numeric(value.ter);
  return pri === undefined || sec === undefined || ter === undefined
    ? undefined
    : `${pri}:${sec}:${ter}`;
}

function normalizeRecord(
  record: TetrioRecord,
  stream: string,
  player: TetrioPlayer,
): StoredRecordInput | undefined {
  const replayId =
    typeof record.replayid === "string" && record.replayid.length > 0
      ? record.replayid
      : undefined;
  const id =
    (typeof record._id === "string" && record._id) ||
    (typeof record.id === "string" && record.id) ||
    replayId;
  if (!id) return undefined;

  const leaderboard = Array.isArray(record.results?.leaderboard)
    ? record.results.leaderboard
    : [];
  const playerEntry = leaderboard.find(
    (entry) =>
      entry.id === player._id ||
      entry.username?.toLowerCase() === player.username.toLowerCase(),
  );
  const opponentEntry = leaderboard.find((entry) => entry !== playerEntry);
  const otherUser = record.otherusers?.[0];
  const stats = playerEntry?.stats ?? record.results?.stats ?? {};
  const playerWins = numeric(playerEntry?.wins);
  const opponentWins = numeric(opponentEntry?.wins);
  const won =
    playerWins !== undefined && opponentWins !== undefined
      ? playerWins > opponentWins
      : undefined;

  return {
    id,
    replayId,
    stream,
    playedAt:
      typeof record.ts === "string" ? record.ts : new Date().toISOString(),
    mode: typeof record.gamemode === "string" ? record.gamemode : stream,
    stub: record.stub === true,
    opponentId: otherUser?.id ?? opponentEntry?.id,
    opponentName: otherUser?.username ?? opponentEntry?.username,
    won,
    playerWins,
    opponentWins,
    rounds: Array.isArray(record.results?.rounds)
      ? record.results.rounds.length
      : undefined,
    apm: numeric(stats.apm),
    pps: numeric(stats.pps),
    vs: numeric(stats.vsscore) ?? numeric(stats.vs),
    garbageSent: numeric(stats.garbagesent),
    garbageReceived: numeric(stats.garbagereceived),
    kills: numeric(stats.kills),
    cursor: cursorToString(record.p),
    rawJson: JSON.stringify(record),
  };
}

export class IrvinTracker {
  readonly status: TrackerRuntimeStatus = {
    running: false,
    phase: "idle",
    discoveredThisRun: 0,
    processedThisRun: 0,
  };

  private player?: TetrioPlayer;
  private syncPromise?: Promise<void>;
  private processingPromise?: Promise<void>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private replayTimer?: ReturnType<typeof setTimeout>;
  private serviceStarted = false;

  constructor(
    readonly config: TrackerConfig,
    readonly database: TrackerDatabase,
    readonly client = new TetrioClient(config),
  ) {}

  get playerSnapshot(): TetrioPlayer | JsonObject | undefined {
    return this.player ?? this.database.getLatestPlayerSnapshot();
  }

  start(): void {
    if (this.pollTimer) return;
    this.serviceStarted = true;
    void this.triggerSync("startup");
    this.status.nextPollAt = new Date(
      Date.now() + this.config.pollIntervalMs,
    ).toISOString();
    this.pollTimer = setInterval(() => {
      this.status.nextPollAt = new Date(
        Date.now() + this.config.pollIntervalMs,
      ).toISOString();
      void this.triggerSync("interval");
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    this.serviceStarted = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.replayTimer) clearTimeout(this.replayTimer);
    this.pollTimer = undefined;
    this.replayTimer = undefined;
  }

  async triggerSync(reason = "manual", drainQueue = false): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSync(reason, drainQueue).finally(() => {
      this.syncPromise = undefined;
    });
    return this.syncPromise;
  }

  private async resolvePlayer(): Promise<TetrioPlayer> {
    const player = await this.client.getPlayer(this.config.username);
    if (this.config.playerId && player._id !== this.config.playerId) {
      throw new Error(
        `TRACK_PLAYER_ID ${this.config.playerId} does not match ${player.username} (${player._id})`,
      );
    }
    this.player = player;
    this.database.savePlayerSnapshot(player);
    return player;
  }

  private async runSync(reason: string, drainQueue: boolean): Promise<void> {
    this.status.running = true;
    this.status.phase = `syncing (${reason})`;
    this.status.lastStartedAt = new Date().toISOString();
    this.status.lastError = undefined;
    this.status.discoveredThisRun = 0;
    this.status.processedThisRun = 0;

    try {
      const player = await this.resolvePlayer();
      for (const stream of this.config.streams) {
        this.status.phase = `syncing ${stream}`;
        try {
          this.status.discoveredThisRun += await this.syncStream(stream, player);
        } catch (error) {
          if (
            error instanceof TetrioHttpError &&
            (error.status === 404 || error.status === 422)
          ) {
            console.warn(
              `[tracker] ${stream} stream is unavailable for ${player.username}: ${error.message}`,
            );
            this.database.setMetadata(`stream:${stream}:unavailable`, error.message);
            continue;
          }
          throw error;
        }
      }

      this.status.phase = "processing replays";
      await this.processReplayQueue(drainQueue);
      if (!drainQueue && this.serviceStarted) this.scheduleReplayDrain();
      this.status.phase = "idle";
      this.status.lastCompletedAt = new Date().toISOString();
      this.database.setMetadata("last_successful_sync", this.status.lastCompletedAt);
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : String(error);
      this.status.phase = "error";
      console.error("[tracker] sync failed:", error);
      throw error;
    } finally {
      this.status.running = false;
    }
  }

  private async syncStream(stream: string, player: TetrioPlayer): Promise<number> {
    const completeKey = `backfill:${stream}:complete`;
    const cursorKey = `backfill:${stream}:cursor`;
    const backfillComplete = this.database.getMetadata(completeKey) === "true";
    let cursor = backfillComplete
      ? undefined
      : this.database.getMetadata(cursorKey);
    let discovered = 0;
    let pages = 0;

    while (pages < this.config.backfillMaxPages) {
      const page = await this.client.getRecords(player.username, stream, cursor);
      pages += 1;
      if (page.entries.length === 0) {
        if (!backfillComplete) this.database.setMetadata(completeKey, "true");
        break;
      }

      let encounteredKnown = false;
      for (const rawRecord of page.entries) {
        const normalized = normalizeRecord(rawRecord, stream, player);
        if (!normalized) continue;
        const alreadyKnown = this.database.hasRecord(normalized.id);
        encounteredKnown ||= alreadyKnown;
        if (this.database.upsertRecord(normalized)) discovered += 1;
      }

      const lastCursor = cursorToString(page.entries.at(-1)?.p);
      if (!lastCursor || lastCursor === cursor) {
        if (!backfillComplete) this.database.setMetadata(completeKey, "true");
        break;
      }

      if (backfillComplete && encounteredKnown) break;
      cursor = lastCursor;
      if (!backfillComplete) this.database.setMetadata(cursorKey, cursor);
      if (page.entries.length < 100) {
        if (!backfillComplete) this.database.setMetadata(completeKey, "true");
        break;
      }
      if (this.config.requestDelayMs > 0) {
        await sleep(this.config.requestDelayMs);
      }
    }

    return discovered;
  }

  private async processReplayQueue(drainQueue: boolean): Promise<void> {
    if (this.processingPromise) return this.processingPromise;
    this.processingPromise = this.runReplayQueue(drainQueue).finally(() => {
      this.processingPromise = undefined;
    });
    return this.processingPromise;
  }

  private async runReplayQueue(drainQueue: boolean): Promise<void> {
    if (!this.player) return;
    do {
      const pending = this.database.getPendingRecords(
        this.config.processBatchSize,
        this.config.maxAnalysisAttempts,
      );
      if (pending.length === 0) break;

      for (const record of pending) {
        try {
          const preferMinomuncher =
            this.config.replaySource === "auto" &&
            !this.config.tetrioToken &&
            Boolean(this.config.minomuncherUrl);

          if (preferMinomuncher) {
            const analysis = await this.client.getMinomuncherAnalysis(
              record.replayId,
            );
            this.database.markProcessed(
              record.id,
              JSON.stringify({
                id: record.replayId,
                source: "minomuncher",
              }),
              analysis,
              findPlayerAnalysis(
                analysis,
                this.player._id,
                this.player.username,
              ),
            );
          } else {
            try {
              const rawReplay = await this.client.downloadReplay(record.replayId);
              const processed = processReplay(
                rawReplay,
                this.player._id,
                this.player.username,
              );
              this.database.markProcessed(
                record.id,
                processed.normalizedReplay,
                processed.analysis,
                processed.playerAnalysis,
              );
            } catch (localError) {
              if (!this.config.minomuncherUrl) throw localError;
              const analysis = await this.client.getMinomuncherAnalysis(
                record.replayId,
              );
              this.database.markProcessed(
                record.id,
                JSON.stringify({
                  id: record.replayId,
                  source: "minomuncher-fallback",
                  localError:
                    localError instanceof Error
                      ? localError.message
                      : String(localError),
                }),
                analysis,
                findPlayerAnalysis(
                  analysis,
                  this.player._id,
                  this.player.username,
                ),
              );
            }
          }
          this.status.processedThisRun += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof TetrioHttpError && error.status === 404) {
            this.database.markUnavailable(record.id, message);
          } else if (
            error instanceof TetrioHttpError &&
            (error.status === 400 || error.status === 422)
          ) {
            this.database.markUnsupported(record.id, message);
          } else if (
            error instanceof ReplayProcessingError &&
            (error.code === "unsupported_replay" || error.code === "zero_rounds")
          ) {
            this.database.markUnsupported(record.id, message);
          } else {
            this.database.markRetry(record.id, record.attempts + 1, message);
          }
          console.warn(`[tracker] replay ${record.replayId}: ${message}`);
        }
        if (this.config.requestDelayMs > 0) {
          await sleep(this.config.requestDelayMs);
        }
      }
    } while (
      drainQueue &&
      this.database.hasPendingRecords(this.config.maxAnalysisAttempts)
    );
  }

  private scheduleReplayDrain(): void {
    if (
      !this.serviceStarted ||
      this.replayTimer ||
      !this.database.hasPendingRecords(this.config.maxAnalysisAttempts)
    ) {
      return;
    }
    this.replayTimer = setTimeout(() => {
      this.replayTimer = undefined;
      void this.processReplayQueue(false)
        .catch((error) => {
          console.warn(
            "[tracker] replay queue pass failed:",
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => this.scheduleReplayDrain());
    }, Math.max(10_000, this.config.requestDelayMs));
  }
}

export { normalizeRecord };
