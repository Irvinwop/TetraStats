import { afterEach, describe, expect, test } from "bun:test";
import { TrackerDatabase } from "../src/database.ts";

let database: TrackerDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("tracker database", () => {
  test("deduplicates games and aggregates summary stats", () => {
    database = new TrackerDatabase(":memory:");
    const base = {
      replayId: "replay-1",
      stream: "league",
      playedAt: "2026-09-18T23:21:51.400Z",
      mode: "league",
      stub: false,
      opponentName: "opponent",
      playerWins: 3,
      opponentWins: 1,
      won: true,
      rounds: 4,
      apm: 50,
      pps: 1.5,
      vs: 100,
      garbageSent: 40,
      garbageReceived: 30,
      kills: 3,
      cursor: "1:0:0",
      rawJson: "{}",
    };

    expect(database.upsertRecord({ id: "game-1", ...base })).toBe(true);
    expect(database.upsertRecord({ id: "game-1", ...base, apm: 52 })).toBe(false);
    expect(database.countRecords()).toBe(1);

    database.markProcessed(
      "game-1",
      JSON.stringify({ replay: { rounds: [{}] } }),
      { player: { username: "Irvinwop" } },
      {
        username: "Irvinwop",
        stats: {
          placement: {
            pieces: 120,
            attack: 60,
            linesCleared: 40,
            keypresses: 240,
            frameDelay: 3_600,
            openerAttack: 12,
            openerFrames: 600,
          },
          garbage: { linesReceived: 30 },
          surge: { attack: 10, chains: 2 },
        },
      },
    );

    const summary = database.getSummary() as any;
    expect(summary.totalRecords).toBe(1);
    expect(summary.competitive.wins).toBe(1);
    expect(summary.competitive.apm).toBe(52);
    expect(summary.replayStatus.processed).toBe(1);
    expect(summary.deep.pieces).toBe(120);
    expect(summary.deep.pps).toBe(2);
    expect(summary.deep.apm).toBe(60);
  });

  test("does not queue stub records for replay processing", () => {
    database = new TrackerDatabase(":memory:");
    database.upsertRecord({
      id: "stub",
      replayId: "old-replay",
      stream: "league",
      playedAt: "2026-01-01T00:00:00.000Z",
      mode: "league",
      stub: true,
      rawJson: "{}",
    });
    expect(database.getPendingRecords(10, 8)).toEqual([]);
    expect((database.getSummary() as any).replayStatus.unavailable).toBe(1);
  });
});
