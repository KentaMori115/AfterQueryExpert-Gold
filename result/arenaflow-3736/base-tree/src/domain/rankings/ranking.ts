import { explain } from "../../explain.js";
import type { PlayerId, RankingEntry, ScoreRecord, TournamentId } from "../../types.js";
import { compareScores } from "../scores/score.js";

export interface RankComputation {
  readonly entries: readonly RankingEntry[];
  readonly generatedFor: TournamentId;
}

export function ranksFromScores(
  tournamentId: TournamentId,
  scores: readonly ScoreRecord[],
  previous?: ReadonlyMap<PlayerId, number>,
): RankComputation {
  const ordered = [...scores].sort(compareScores);
  const entries: RankingEntry[] = ordered.map((score, index) => {
    const rank = index + 1;
    const previousRank = previous?.get(score.playerId);
    const movement = previousRank === undefined ? 0 : previousRank - rank;
    return Object.freeze({
      playerId: score.playerId,
      tournamentId,
      rank,
      score: score.total,
      tieBreakScore: score.wins * 1000 + score.bestStreak,
      previousRank,
      movement,
      explanation: explain("rank.computed", `rank ${rank} for ${score.playerId}`, {
        total: score.total,
        wins: score.wins,
        bestStreak: score.bestStreak,
        previousRank,
        movement,
      }),
    });
  });
  return { generatedFor: tournamentId, entries: Object.freeze(entries) };
}

export function rankOf(entries: readonly RankingEntry[], playerId: PlayerId): RankingEntry | undefined {
  return entries.find((entry) => entry.playerId === playerId);
}

export function movementLabel(entry: RankingEntry): string {
  if (entry.previousRank === undefined) {
    return "new";
  }
  if (entry.movement > 0) {
    return `up ${entry.movement}`;
  }
  if (entry.movement < 0) {
    return `down ${Math.abs(entry.movement)}`;
  }
  return "unchanged";
}
