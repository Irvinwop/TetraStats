import { parseReplay } from "minomuncher-core";
import {
  ReplayProcessingError,
  type ProcessedReplay,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseReplayJson(rawReplay: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(rawReplay);
    if (!isObject(parsed)) {
      throw new ReplayProcessingError(
        "Replay JSON must contain an object",
        "invalid_json",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof ReplayProcessingError) throw error;
    throw new ReplayProcessingError(
      `Replay body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "invalid_json",
    );
  }
}

export function normalizeReplayObject(input: JsonObject): JsonObject {
  let value = input;
  for (let depth = 0; depth < 8; depth += 1) {
    if (isObject(value.game)) {
      value = value.game;
      continue;
    }
    if (isObject(value.data) && isObject(value.data.game)) {
      value = value.data.game;
      continue;
    }
    break;
  }
  return value;
}

export function replayRoundCount(input: JsonObject): number | undefined {
  let value = input;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!isObject(value.replay)) return undefined;
    if (isObject(value.replay.replay)) {
      value = value.replay;
      continue;
    }
    const rounds = value.replay.rounds;
    return Array.isArray(rounds) ? rounds.length : undefined;
  }
  return undefined;
}

export function findPlayerAnalysis(
  analysis: JsonObject,
  playerId: string,
  username: string,
): JsonObject | undefined {
  const byId = analysis[playerId];
  if (isObject(byId)) return byId;

  const normalizedUsername = username.toLowerCase();
  for (const value of Object.values(analysis)) {
    if (
      isObject(value) &&
      typeof value.username === "string" &&
      value.username.toLowerCase() === normalizedUsername
    ) {
      return value;
    }
  }
  return undefined;
}

export function processReplay(
  rawReplay: string,
  playerId: string,
  username: string,
): ProcessedReplay {
  const normalized = normalizeReplayObject(parseReplayJson(rawReplay));
  const rounds = replayRoundCount(normalized);
  if (rounds === undefined) {
    throw new ReplayProcessingError(
      "This replay format is not supported by the versus-game processor",
      "unsupported_replay",
    );
  }
  if (rounds === 0) {
    throw new ReplayProcessingError(
      "Replay has no rounds and cannot produce game statistics",
      "zero_rounds",
    );
  }

  const normalizedReplay = JSON.stringify(normalized);
  let parsed: unknown;
  try {
    parsed = parseReplay(normalizedReplay);
  } catch (error) {
    throw new ReplayProcessingError(
      `Replay processor failed: ${error instanceof Error ? error.message : String(error)}`,
      "processor_failed",
    );
  }

  if (!isObject(parsed) || Object.keys(parsed).length === 0) {
    throw new ReplayProcessingError(
      "Replay processor returned no player statistics",
      "processor_failed",
    );
  }

  return {
    normalizedReplay,
    analysis: parsed,
    playerAnalysis: findPlayerAnalysis(parsed, playerId, username),
  };
}
