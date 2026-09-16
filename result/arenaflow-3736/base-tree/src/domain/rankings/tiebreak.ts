import type { ScoreRecord } from "../../types.js";

export type TieBreakStrategy = "score_wins_streak_time_id" | "score_time_id" | "score_id";

export function compareWithStrategy(
  a: ScoreRecord,
  b: ScoreRecord,
  strategy: TieBreakStrategy,
): number {
  if (a.total !== b.total) {
    return b.total - a.total;
  }
  if (strategy === "score_id") {
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  }
  if (strategy === "score_time_id") {
    if (a.lastUpdatedAt !== b.lastUpdatedAt) {
      return a.lastUpdatedAt - b.lastUpdatedAt;
    }
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  }
  if (a.wins !== b.wins) {
    return b.wins - a.wins;
  }
  if (a.bestStreak !== b.bestStreak) {
    return b.bestStreak - a.bestStreak;
  }
  if (a.lastUpdatedAt !== b.lastUpdatedAt) {
    return a.lastUpdatedAt - b.lastUpdatedAt;
  }
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
}

export function isTie(a: ScoreRecord, b: ScoreRecord): boolean {
  return a.total === b.total;
}
