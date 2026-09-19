import { describe, expect, test } from "bun:test";
import {
  findPlayerAnalysis,
  normalizeReplayObject,
  processReplay,
  replayRoundCount,
} from "../src/processor.ts";
import { ReplayProcessingError } from "../src/types.ts";

describe("replay processor validation", () => {
  test("unwraps official game responses", () => {
    const game = { replay: { rounds: [] } };
    expect(normalizeReplayObject({ success: true, game })).toEqual(game);
    expect(replayRoundCount(game)).toBe(0);
  });

  test("descends through nested replay containers", () => {
    expect(
      replayRoundCount({ replay: { replay: { rounds: [[{ id: "p1" }]] } } }),
    ).toBe(1);
  });

  test("rejects zero-round games before minomuncher", () => {
    expect(() =>
      processReplay(
        JSON.stringify({ id: "zero", replay: { rounds: [] } }),
        "player-id",
        "player",
      ),
    ).toThrow(ReplayProcessingError);
    try {
      processReplay(
        JSON.stringify({ id: "zero", replay: { rounds: [] } }),
        "player-id",
        "player",
      );
    } catch (error) {
      expect((error as ReplayProcessingError).code).toBe("zero_rounds");
    }
  });

  test("rejects unsupported replay shapes", () => {
    expect(() => processReplay("{}", "player-id", "player")).toThrow(
      "not supported",
    );
  });

  test("selects player data by id and username", () => {
    const byId = { username: "Irvinwop", stats: {} };
    expect(findPlayerAnalysis({ abc: byId }, "abc", "other")).toBe(byId);
    expect(findPlayerAnalysis({ abc: byId }, "missing", "irvinwop")).toBe(byId);
  });
});
