import type { RankingEntry, TournamentId } from "../../types.js";

export interface Leaderboard {
  readonly id: string;
  readonly tournamentId: TournamentId;
  readonly entries: readonly RankingEntry[];
  readonly size: number;
}

export function toLeaderboard(tournamentId: TournamentId, entries: readonly RankingEntry[]): Leaderboard {
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  return Object.freeze({
    id: `ldr_${tournamentId}`,
    tournamentId,
    entries: Object.freeze(ordered),
    size: ordered.length,
  });
}

export function topN(board: Leaderboard, n: number): RankingEntry[] {
  return board.entries.slice(0, Math.max(0, n));
}

export function sliceBoard(board: Leaderboard, offset: number, limit: number): RankingEntry[] {
  return board.entries.slice(offset, offset + limit);
}
