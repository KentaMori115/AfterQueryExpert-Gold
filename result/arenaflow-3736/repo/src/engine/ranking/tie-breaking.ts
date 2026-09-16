import type { ScoreRecord } from "../../types.js";
import { compareWithStrategy, type TieBreakStrategy } from "../../domain/rankings/tiebreak.js";

export const TIE_BREAK_STRATEGIES: readonly TieBreakStrategy[] = [
  "score_wins_streak_time_id",
  "score_time_id",
  "score_id",
];

export function resolveTiedGroup(
  scores: readonly ScoreRecord[],
  strategy: TieBreakStrategy,
): ScoreRecord[] {
  return [...scores].sort((a, b) => compareWithStrategy(a, b, strategy));
}

export function groupByTotal(scores: readonly ScoreRecord[]): ScoreRecord[][] {
  const groups = new Map<number, ScoreRecord[]>();
  for (const score of scores) {
    const current = groups.get(score.total) ?? [];
    current.push(score);
    groups.set(score.total, current);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, group]) => group);
}

export function explainTieBreak(strategy: TieBreakStrategy): string {
  switch (strategy) {
    case "score_id":
      return "higher score, then lexicographic player id";
    case "score_time_id":
      return "higher score, then earlier last update, then player id";
    default:
      return "higher score, then wins, then best streak, then earlier last update, then player id";
  }
}
