import { Database } from "bun:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  PendingRecord,
  StoredRecordInput,
  TetrioPlayer,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function parseJsonObject(value: unknown): JsonObject | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

function numberAt(value: unknown, path: string[]): number {
  let cursor: unknown = value;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return 0;
    cursor = (cursor as JsonObject)[segment];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : 0;
}

function aggregateDeepStats(rows: Array<{ player_analysis_json: string }>) {
  const totals = {
    games: 0,
    pieces: 0,
    attack: 0,
    linesCleared: 0,
    keypresses: 0,
    frames: 0,
    openerAttack: 0,
    openerFrames: 0,
    garbageReceived: 0,
    surgeAttack: 0,
    surgeChains: 0,
  };

  for (const row of rows) {
    const player = parseJsonObject(row.player_analysis_json);
    if (!player) continue;
    totals.games += 1;
    totals.pieces += numberAt(player, ["stats", "placement", "pieces"]);
    totals.attack += numberAt(player, ["stats", "placement", "attack"]);
    totals.linesCleared += numberAt(player, ["stats", "placement", "linesCleared"]);
    totals.keypresses += numberAt(player, ["stats", "placement", "keypresses"]);
    totals.frames += numberAt(player, ["stats", "placement", "frameDelay"]);
    totals.openerAttack += numberAt(player, ["stats", "placement", "openerAttack"]);
    totals.openerFrames += numberAt(player, ["stats", "placement", "openerFrames"]);
    totals.garbageReceived += numberAt(player, ["stats", "garbage", "linesReceived"]);
    totals.surgeAttack += numberAt(player, ["stats", "surge", "attack"]);
    totals.surgeChains += numberAt(player, ["stats", "surge", "chains"]);
  }

  const seconds = totals.frames / 60;
  const minutes = seconds / 60;
  return {
    ...totals,
    apm: minutes > 0 ? totals.attack / minutes : null,
    pps: seconds > 0 ? totals.pieces / seconds : null,
    app: totals.pieces > 0 ? totals.attack / totals.pieces : null,
    apl: totals.linesCleared > 0 ? totals.attack / totals.linesCleared : null,
    kpp: totals.pieces > 0 ? totals.keypresses / totals.pieces : null,
    openerApm:
      totals.openerFrames > 0
        ? totals.openerAttack / (totals.openerFrames / 3600)
        : null,
  };
}

export class TrackerDatabase {
  readonly db: Database;

  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_snapshots (
        captured_at TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        username TEXT NOT NULL,
        games_played INTEGER,
        games_won INTEGER,
        country TEXT,
        raw_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        replay_id TEXT,
        stream TEXT NOT NULL,
        played_at TEXT NOT NULL,
        mode TEXT NOT NULL,
        stub INTEGER NOT NULL DEFAULT 0,
        opponent_id TEXT,
        opponent_name TEXT,
        won INTEGER,
        player_wins INTEGER,
        opponent_wins INTEGER,
        rounds INTEGER,
        apm REAL,
        pps REAL,
        vs REAL,
        garbage_sent INTEGER,
        garbage_received INTEGER,
        kills INTEGER,
        cursor TEXT,
        raw_json TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        replay_status TEXT NOT NULL DEFAULT 'pending',
        replay_error TEXT,
        replay_json TEXT,
        analysis_json TEXT,
        player_analysis_json TEXT,
        analyzed_at TEXT,
        analysis_attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS records_replay_id_unique
        ON records(replay_id)
        WHERE replay_id IS NOT NULL AND replay_id != '' AND replay_id != 'none';
      CREATE INDEX IF NOT EXISTS records_played_at_idx ON records(played_at DESC);
      CREATE INDEX IF NOT EXISTS records_stream_idx ON records(stream, played_at DESC);
      CREATE INDEX IF NOT EXISTS records_replay_status_idx
        ON records(replay_status, next_retry_at, played_at DESC);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      UPDATE records
      SET replay_status = 'unsupported', next_retry_at = NULL
      WHERE replay_status = 'retry'
        AND replay_error LIKE '%400 Bad Request:%error parsing%';
    `);
  }

  close(): void {
    this.db.close();
  }

  savePlayerSnapshot(player: TetrioPlayer, capturedAt = new Date().toISOString()): void {
    this.db
      .query(`
        INSERT OR REPLACE INTO player_snapshots (
          captured_at, player_id, username, games_played, games_won, country, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        capturedAt,
        player._id,
        player.username,
        player.gamesplayed ?? null,
        player.gameswon ?? null,
        player.country ?? null,
        JSON.stringify(player),
      );
  }

  getLatestPlayerSnapshot(): JsonObject | undefined {
    const row = this.db
      .query(`SELECT raw_json FROM player_snapshots ORDER BY captured_at DESC LIMIT 1`)
      .get() as { raw_json: string } | null;
    return row ? parseJsonObject(row.raw_json) : undefined;
  }

  hasRecord(id: string): boolean {
    return Boolean(
      this.db.query(`SELECT 1 FROM records WHERE id = ? LIMIT 1`).get(id),
    );
  }

  countRecords(stream?: string): number {
    const row = stream
      ? (this.db
          .query(`SELECT COUNT(*) AS count FROM records WHERE stream = ?`)
          .get(stream) as { count: number })
      : (this.db.query(`SELECT COUNT(*) AS count FROM records`).get() as {
          count: number;
        });
    return row.count;
  }

  upsertRecord(record: StoredRecordInput): boolean {
    const existed = this.hasRecord(record.id);
    const now = new Date().toISOString();
    const initialStatus =
      record.stub || !record.replayId || record.replayId === "none"
        ? "unavailable"
        : "pending";

    this.db
      .query(`
        INSERT INTO records (
          id, replay_id, stream, played_at, mode, stub,
          opponent_id, opponent_name, won, player_wins, opponent_wins, rounds,
          apm, pps, vs, garbage_sent, garbage_received, kills,
          cursor, raw_json, discovered_at, updated_at, replay_status
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          replay_id = excluded.replay_id,
          stream = excluded.stream,
          played_at = excluded.played_at,
          mode = excluded.mode,
          stub = excluded.stub,
          opponent_id = excluded.opponent_id,
          opponent_name = excluded.opponent_name,
          won = excluded.won,
          player_wins = excluded.player_wins,
          opponent_wins = excluded.opponent_wins,
          rounds = excluded.rounds,
          apm = excluded.apm,
          pps = excluded.pps,
          vs = excluded.vs,
          garbage_sent = excluded.garbage_sent,
          garbage_received = excluded.garbage_received,
          kills = excluded.kills,
          cursor = excluded.cursor,
          raw_json = excluded.raw_json,
          updated_at = excluded.updated_at,
          replay_status = CASE
            WHEN records.replay_status = 'processed' THEN records.replay_status
            WHEN excluded.stub = 1 OR excluded.replay_id IS NULL OR excluded.replay_id = 'none'
              THEN 'unavailable'
            WHEN records.replay_status = 'unavailable' AND excluded.stub = 0
              THEN 'pending'
            ELSE records.replay_status
          END
      `)
      .run(
        record.id,
        record.replayId ?? null,
        record.stream,
        record.playedAt,
        record.mode,
        record.stub ? 1 : 0,
        record.opponentId ?? null,
        record.opponentName ?? null,
        record.won === undefined ? null : record.won ? 1 : 0,
        record.playerWins ?? null,
        record.opponentWins ?? null,
        record.rounds ?? null,
        record.apm ?? null,
        record.pps ?? null,
        record.vs ?? null,
        record.garbageSent ?? null,
        record.garbageReceived ?? null,
        record.kills ?? null,
        record.cursor ?? null,
        record.rawJson,
        now,
        now,
        initialStatus,
      );

    return !existed;
  }

  getPendingRecords(limit: number, maxAttempts: number): PendingRecord[] {
    const now = new Date().toISOString();
    return this.db
      .query(`
        SELECT id, replay_id AS replayId, stream, analysis_attempts AS attempts
        FROM records
        WHERE replay_id IS NOT NULL
          AND replay_id != ''
          AND replay_id != 'none'
          AND stub = 0
          AND replay_status IN ('pending', 'retry')
          AND analysis_attempts < ?
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY played_at DESC
        LIMIT ?
      `)
      .all(maxAttempts, now, limit) as PendingRecord[];
  }

  markProcessed(
    id: string,
    replayJson: string,
    analysis: JsonObject,
    playerAnalysis?: JsonObject,
  ): void {
    this.db
      .query(`
        UPDATE records SET
          replay_status = 'processed',
          replay_error = NULL,
          replay_json = ?,
          analysis_json = ?,
          player_analysis_json = ?,
          analyzed_at = ?,
          analysis_attempts = analysis_attempts + 1,
          next_retry_at = NULL,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        replayJson,
        JSON.stringify(analysis),
        playerAnalysis ? JSON.stringify(playerAnalysis) : null,
        new Date().toISOString(),
        new Date().toISOString(),
        id,
      );
  }

  markUnavailable(id: string, error: string): void {
    this.setTerminalReplayStatus(id, "unavailable", error);
  }

  markUnsupported(id: string, error: string): void {
    this.setTerminalReplayStatus(id, "unsupported", error);
  }

  private setTerminalReplayStatus(id: string, status: string, error: string): void {
    this.db
      .query(`
        UPDATE records SET
          replay_status = ?,
          replay_error = ?,
          analysis_attempts = analysis_attempts + 1,
          next_retry_at = NULL,
          updated_at = ?
        WHERE id = ?
      `)
      .run(status, error, new Date().toISOString(), id);
  }

  markRetry(id: string, attempts: number, error: string): void {
    const delayMinutes = Math.min(360, 2 ** Math.min(attempts, 8));
    const nextRetryAt = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    this.db
      .query(`
        UPDATE records SET
          replay_status = 'retry',
          replay_error = ?,
          analysis_attempts = analysis_attempts + 1,
          next_retry_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(error, nextRetryAt, new Date().toISOString(), id);
  }

  setMetadata(key: string, value: string): void {
    this.db
      .query(`
        INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(key, value, new Date().toISOString());
  }

  getMetadata(key: string): string | undefined {
    const row = this.db
      .query(`SELECT value FROM metadata WHERE key = ?`)
      .get(key) as { value: string } | null;
    return row?.value;
  }

  hasPendingRecords(maxAttempts: number): boolean {
    const now = new Date().toISOString();
    return Boolean(
      this.db
        .query(`
          SELECT 1 FROM records
          WHERE replay_id IS NOT NULL
            AND replay_id != ''
            AND replay_id != 'none'
            AND stub = 0
            AND replay_status IN ('pending', 'retry')
            AND analysis_attempts < ?
            AND (next_retry_at IS NULL OR next_retry_at <= ?)
          LIMIT 1
        `)
        .get(maxAttempts, now),
    );
  }

  getSummary(): JsonObject {
    const competitive = this.db
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) AS losses,
          AVG(apm) AS apm,
          AVG(pps) AS pps,
          AVG(vs) AS vs,
          SUM(garbage_sent) AS garbageSent,
          SUM(garbage_received) AS garbageReceived,
          SUM(kills) AS kills
        FROM records
        WHERE stream = 'league'
      `)
      .get() as Record<string, number | null>;

    const statusRows = this.db
      .query(`
        SELECT replay_status AS status, COUNT(*) AS count
        FROM records
        GROUP BY replay_status
      `)
      .all() as Array<{ status: string; count: number }>;
    const streamRows = this.db
      .query(`
        SELECT stream, COUNT(*) AS count
        FROM records
        GROUP BY stream
        ORDER BY stream
      `)
      .all() as Array<{ stream: string; count: number }>;
    const deepRows = this.db
      .query(`
        SELECT player_analysis_json
        FROM records
        WHERE replay_status = 'processed' AND player_analysis_json IS NOT NULL
      `)
      .all() as Array<{ player_analysis_json: string }>;
    const firstAndLast = this.db
      .query(`
        SELECT MIN(played_at) AS firstGameAt, MAX(played_at) AS lastGameAt
        FROM records
      `)
      .get() as { firstGameAt: string | null; lastGameAt: string | null };

    const wins = competitive.wins ?? 0;
    const losses = competitive.losses ?? 0;
    const decided = wins + losses;
    return {
      totalRecords: this.countRecords(),
      streams: Object.fromEntries(streamRows.map((row) => [row.stream, row.count])),
      replayStatus: Object.fromEntries(
        statusRows.map((row) => [row.status, row.count]),
      ),
      competitive: {
        ...competitive,
        wins,
        losses,
        winRate: decided > 0 ? wins / decided : null,
      },
      deep: aggregateDeepStats(deepRows),
      ...firstAndLast,
    };
  }

  listRecords(options: {
    limit: number;
    offset: number;
    stream?: string;
    status?: string;
  }): JsonObject[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.stream) {
      conditions.push("stream = ?");
      parameters.push(options.stream);
    }
    if (options.status) {
      conditions.push("replay_status = ?");
      parameters.push(options.status);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    parameters.push(options.limit, options.offset);

    return this.db
      .query(`
        SELECT
          id, replay_id AS replayId, stream, played_at AS playedAt, mode, stub,
          opponent_id AS opponentId, opponent_name AS opponentName, won,
          player_wins AS playerWins, opponent_wins AS opponentWins, rounds,
          apm, pps, vs, garbage_sent AS garbageSent,
          garbage_received AS garbageReceived, kills,
          replay_status AS replayStatus, replay_error AS replayError,
          analyzed_at AS analyzedAt, analysis_attempts AS analysisAttempts
        FROM records
        ${where}
        ORDER BY played_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...parameters)
      .map((row) => {
        const value = row as JsonObject;
        return {
          ...value,
          stub: Boolean(value.stub),
          won: value.won === null ? null : Boolean(value.won),
        };
      });
  }

  getRecord(id: string): JsonObject | undefined {
    const row = this.db.query(`SELECT * FROM records WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | null;
    if (!row) return undefined;
    return {
      ...row,
      stub: Boolean(row.stub),
      won: row.won === null ? null : Boolean(row.won),
      raw: parseJsonObject(row.raw_json),
      replay: parseJsonObject(row.replay_json),
      analysis: parseJsonObject(row.analysis_json),
      playerAnalysis: parseJsonObject(row.player_analysis_json),
      raw_json: undefined,
      replay_json: undefined,
      analysis_json: undefined,
      player_analysis_json: undefined,
    };
  }

  exportAll(): JsonObject {
    const records = this.db
      .query(`SELECT * FROM records ORDER BY played_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return {
      exportedAt: new Date().toISOString(),
      player: this.getLatestPlayerSnapshot(),
      summary: this.getSummary(),
      records: records.map((row) => ({
        ...row,
        raw: parseJsonObject(row.raw_json),
        replay: parseJsonObject(row.replay_json),
        analysis: parseJsonObject(row.analysis_json),
        playerAnalysis: parseJsonObject(row.player_analysis_json),
        raw_json: undefined,
        replay_json: undefined,
        analysis_json: undefined,
        player_analysis_json: undefined,
      })),
    };
  }
}
