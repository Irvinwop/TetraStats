export interface Prisecter {
  pri: number;
  sec: number;
  ter: number;
}

export interface TetrioPlayer {
  _id: string;
  username: string;
  country?: string;
  gamesplayed?: number;
  gameswon?: number;
  league?: unknown;
  [key: string]: unknown;
}

export interface TetrioRecord {
  _id?: string;
  id?: string;
  replayid?: string;
  ts?: string;
  gamemode?: string;
  stub?: boolean;
  p?: Prisecter;
  otherusers?: Array<{
    id?: string;
    username?: string;
    [key: string]: unknown;
  }>;
  results?: {
    leaderboard?: Array<{
      id?: string;
      username?: string;
      wins?: number;
      stats?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
    rounds?: unknown[];
    stats?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RecordsPage {
  entries: TetrioRecord[];
  cachedUntil?: number;
}

export interface StoredRecordInput {
  id: string;
  replayId?: string;
  stream: string;
  playedAt: string;
  mode: string;
  stub: boolean;
  opponentId?: string;
  opponentName?: string;
  won?: boolean;
  playerWins?: number;
  opponentWins?: number;
  rounds?: number;
  apm?: number;
  pps?: number;
  vs?: number;
  garbageSent?: number;
  garbageReceived?: number;
  kills?: number;
  cursor?: string;
  rawJson: string;
}

export interface PendingRecord {
  id: string;
  replayId: string;
  stream: string;
  attempts: number;
}

export interface TrackerRuntimeStatus {
  running: boolean;
  phase: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastError?: string;
  nextPollAt?: string;
  discoveredThisRun: number;
  processedThisRun: number;
}

export interface ProcessedReplay {
  normalizedReplay: string;
  analysis: Record<string, unknown>;
  playerAnalysis?: Record<string, unknown>;
}

export class TetrioHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "TetrioHttpError";
  }
}

export class ReplayProcessingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_json"
      | "unsupported_replay"
      | "zero_rounds"
      | "processor_failed",
  ) {
    super(message);
    this.name = "ReplayProcessingError";
  }
}
