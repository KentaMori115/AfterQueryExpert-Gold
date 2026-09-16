import { explain } from "../../explain.js";
import type { PlayerId, RankingEntry, ScoreRecord, TournamentId } from "../../types.js";
import { toLeaderboard, type RankComputation } from "../../domain/rankings/index.js";
import { compareWithStrategy, type TieBreakStrategy } from "../../domain/rankings/tiebreak.js";

export interface RankingEngineOptions {
  readonly strategy?: TieBreakStrategy;
}

export class RankingEngine {
  constructor(private readonly options: RankingEngineOptions = {}) {}

  compute(
    tournamentId: TournamentId,
    scores: readonly ScoreRecord[],
    previous?: ReadonlyMap<PlayerId, number>,
  ): RankComputation {
    const strategy = this.options.strategy ?? "score_wins_streak_time_id";
    const ordered = [...scores].sort((a, b) => compareWithStrategy(a, b, strategy));
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
          strategy,
          previousRank,
          movement,
        }),
      });
    });
    return { generatedFor: tournamentId, entries: Object.freeze(entries) };
  }

  leaderboard(
    tournamentId: TournamentId,
    scores: readonly ScoreRecord[],
    previous?: ReadonlyMap<PlayerId, number>,
  ) {
    return toLeaderboard(tournamentId, this.compute(tournamentId, scores, previous).entries);
  }

  previousRankMap(entries: readonly RankingEntry[]): Map<PlayerId, number> {
    return new Map(entries.map((entry) => [entry.playerId, entry.rank]));
  }

  recomputeAfterReversal(
    tournamentId: TournamentId,
    scores: readonly ScoreRecord[],
    previous: readonly RankingEntry[],
  ): RankComputation {
    return this.compute(tournamentId, scores, this.previousRankMap(previous));
  }

  /**
   * After a voided or reversed result, movement must be measured against
   * the last published board, not against the tainted intermediate ranks.
   */
  recomputePublished(
    tournamentId: TournamentId,
    scores: readonly ScoreRecord[],
    published: readonly RankingEntry[] | undefined,
  ): RankComputation {
    const baseline = published ? this.previousRankMap(published) : undefined;
    return this.compute(tournamentId, scores, baseline);
  }
}

export const rankingEngine = new RankingEngine();
