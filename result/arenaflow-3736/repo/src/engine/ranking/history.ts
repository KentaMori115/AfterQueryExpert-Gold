import type { EpochMillis } from "../../clock.js";
import type { PlayerId, RankingEntry, TournamentId } from "../../types.js";

export interface RankHistoryPoint {
  readonly at: EpochMillis;
  readonly tournamentId: TournamentId;
  readonly playerId: PlayerId;
  readonly rank: number;
  readonly score: number;
  readonly movement: number;
}

export class RankHistory {
  private readonly points: RankHistoryPoint[] = [];

  record(at: EpochMillis, entries: readonly RankingEntry[]): void {
    for (const entry of entries) {
      this.points.push({
        at,
        tournamentId: entry.tournamentId,
        playerId: entry.playerId,
        rank: entry.rank,
        score: entry.score,
        movement: entry.movement,
      });
    }
  }

  forPlayer(playerId: PlayerId, tournamentId?: TournamentId): RankHistoryPoint[] {
    return this.points.filter(
      (point) =>
        point.playerId === playerId && (tournamentId === undefined || point.tournamentId === tournamentId),
    );
  }

  latest(playerId: PlayerId, tournamentId: TournamentId): RankHistoryPoint | undefined {
    const matches = this.forPlayer(playerId, tournamentId);
    return matches[matches.length - 1];
  }

  peakRank(playerId: PlayerId, tournamentId: TournamentId): number | undefined {
    const ranks = this.forPlayer(playerId, tournamentId).map((point) => point.rank);
    if (ranks.length === 0) {
      return undefined;
    }
    return Math.min(...ranks);
  }

  all(): RankHistoryPoint[] {
    return [...this.points].sort((a, b) => a.at - b.at || a.rank - b.rank || a.playerId.localeCompare(b.playerId));
  }
}
