import type { EpochMillis } from "../../clock.js";
import type {
  MatchRecord,
  PlayerId,
  PlayerRecord,
  ScoreRecord,
  TournamentId,
  TournamentRecord,
} from "../../types.js";
import { emptyScore } from "../../domain/scores/score.js";
import { resultFor } from "../../domain/matches/result.js";
import { scoringEngine } from "../scoring/scoring-engine.js";

/**
 * Rebuilding a score is the only honest way to undo a match. A score record
 * carries a running total, a streak, a best streak and an append-only list of
 * explanations, and every one of those depends on the order results arrived
 * in. Subtracting the awarded points of a single match leaves the streak, the
 * bonuses that streak paid for and the history describing them all wrong, so
 * the rebuild walks what is left instead.
 */
export interface RescoreInput {
  readonly tournament: TournamentRecord;
  readonly players: readonly PlayerRecord[];
  readonly matches: readonly MatchRecord[];
  readonly playerIds: readonly PlayerId[];
  readonly at: EpochMillis;
}

/**
 * Settled order for a tournament's matches: the moment a match completed,
 * then its id. Both keys are recorded facts, so a rebuild run now and the
 * same rebuild run during a replay walk the results the same way.
 */
export function compareSettled(a: MatchRecord, b: MatchRecord): number {
  const left = a.completedAt ?? a.createdAt;
  const right = b.completedAt ?? b.createdAt;
  if (left !== right) {
    return left - right;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The matches of a tournament that still count: completed, never voided,
 * oldest first.
 */
export function standingMatches(
  matches: readonly MatchRecord[],
  tournamentId: TournamentId,
): MatchRecord[] {
  return matches
    .filter((match) => match.tournamentId === tournamentId && match.status === "completed")
    .sort(compareSettled);
}

/**
 * Replay one player's results through the tournament's scoring config. The
 * scoring engine decides each award against the score built so far, so a win
 * that once paid a streak bonus stops paying it when the win before it is
 * gone.
 */
export function rescorePlayer(
  tournament: TournamentRecord,
  player: PlayerRecord,
  matches: readonly MatchRecord[],
  at: EpochMillis,
): ScoreRecord {
  let score = emptyScore(player.id, tournament.id, at);
  for (const match of standingMatches(matches, tournament.id)) {
    const result = resultFor(match, player.id);
    if (!result) {
      continue;
    }
    const decision = scoringEngine.decide({
      player,
      tournament,
      current: score,
      outcome: result.outcome,
      rawScore: result.rawScore,
      at: match.completedAt ?? at,
    });
    score = decision.next;
  }
  return score;
}

/**
 * Rebuild the named players. Everyone else keeps the record they already
 * have: their own results did not move.
 */
export function rescoreTournament(input: RescoreInput): ScoreRecord[] {
  const byId = new Map(input.players.map((player) => [player.id, player] as const));
  const rebuilt: ScoreRecord[] = [];
  for (const playerId of [...new Set(input.playerIds)].sort()) {
    const player = byId.get(playerId);
    if (!player) {
      continue;
    }
    rebuilt.push(rescorePlayer(input.tournament, player, input.matches, input.at));
  }
  return rebuilt;
}
