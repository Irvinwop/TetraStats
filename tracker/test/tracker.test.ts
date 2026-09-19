import { describe, expect, test } from "bun:test";
import { normalizeRecord, shouldUseMinomuncher } from "../src/tracker.ts";

describe("TETR.IO record normalization", () => {
  test("extracts Irvinwop's side regardless of leaderboard order", () => {
    const normalized = normalizeRecord(
      {
        _id: "record-id",
        replayid: "replay-id",
        ts: "2026-09-18T23:21:51.400Z",
        gamemode: "league",
        stub: false,
        p: { pri: 10, sec: 0, ter: 0 },
        otherusers: [{ id: "opponent-id", username: "Opponent" }],
        results: {
          leaderboard: [
            {
              id: "opponent-id",
              username: "Opponent",
              wins: 3,
              stats: { apm: 40, pps: 1.8, vsscore: 90 },
            },
            {
              id: "player-id",
              username: "Irvinwop",
              wins: 2,
              stats: {
                apm: 32.5,
                pps: 1.25,
                vsscore: 69.5,
                garbagesent: 94,
                garbagereceived: 117,
                kills: 2,
              },
            },
          ],
          rounds: [{}, {}, {}, {}, {}],
        },
      },
      "league",
      { _id: "player-id", username: "irvinwop" },
    );

    expect(normalized).toMatchObject({
      id: "record-id",
      replayId: "replay-id",
      opponentName: "Opponent",
      won: false,
      playerWins: 2,
      opponentWins: 3,
      rounds: 5,
      apm: 32.5,
      pps: 1.25,
      vs: 69.5,
      cursor: "10:0:0",
    });
  });

  test("only Tetra League records use MinoMuncher in auto mode", () => {
    const config = {
      replaySource: "auto" as const,
      tetrioToken: undefined,
      minomuncherUrl: "https://minomuncher.com",
    };

    expect(shouldUseMinomuncher({ stream: "league" }, config)).toBe(true);
    expect(shouldUseMinomuncher({ stream: "40l" }, config)).toBe(false);
    expect(shouldUseMinomuncher({ stream: "blitz" }, config)).toBe(false);
    expect(shouldUseMinomuncher({ stream: "zenith" }, config)).toBe(false);
  });
});
