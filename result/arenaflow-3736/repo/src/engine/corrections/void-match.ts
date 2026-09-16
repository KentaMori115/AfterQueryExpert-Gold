import { IllegalStateError, InvalidArgumentError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type {
  MatchRecord,
  PlayerId,
  PlayerRecord,
  ScoreRecord,
  TournamentId,
  TournamentRecord,
} from "../../types.js";
import { voidMatch } from "../../domain/matches/match.js";
import { rescoreTournament } from "./rescore.js";

export interface VoidMatchInput {
  readonly match: MatchRecord;
  readonly tournament: TournamentRecord;
  readonly players: readonly PlayerRecord[];
  readonly matches: readonly MatchRecord[];
  readonly scores: readonly ScoreRecord[];
  readonly reason: string;
  readonly at: EpochMillis;
}

/**
 * What a withdrawal did: the match that was pulled, why, when, and the score
 * records that had to be rebuilt because of it.
 */
export interface WithdrawalRecord {
  readonly match: MatchRecord;
  readonly tournamentId: TournamentId;
  readonly reason: string;
  readonly at: EpochMillis;
  readonly rebuilt: readonly ScoreRecord[];
  readonly explanation: DecisionExplanation;
}

/** One player's total before and after the rebuild, for the audit trail. */
export interface WithdrawalMovement {
  readonly playerId: PlayerId;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/**
 * A result is only withdrawn while the competition is still running. Once a
 * tournament is completed its board has been ranked and its prize pool may
 * already be paid, and a v1 payout is not reversible.
 */
export function assertVoidable(match: MatchRecord, tournament: TournamentRecord): void {
  if (tournament.status !== "active") {
    throw new IllegalStateError("matches can only be voided while a tournament is active", {
      tournamentId: tournament.id,
      status: tournament.status,
    });
  }
  if (match.status !== "completed") {
    throw new IllegalStateError("only a completed match can be voided", {
      matchId: match.id,
      status: match.status,
    });
  }
}

export function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("a void needs a reason");
  }
  return trimmed;
}

/** The players whose scores the voided match touched. */
export function affectedPlayerIds(match: MatchRecord): PlayerId[] {
  return [...new Set(match.results.map((result) => result.playerId))].sort();
}

/**
 * Structured evidence for the withdrawal: what each rebuilt player was
 * carrying, and what they carry now. Nothing else in the engine can answer
 * that afterwards, because the old totals are gone once the rebuild lands.
 */
export function withdrawalMovements(
  before: readonly ScoreRecord[],
  after: readonly ScoreRecord[],
): WithdrawalMovement[] {
  return after.map((score) => {
    const previous = before.find(
      (candidate) =>
        candidate.playerId === score.playerId && candidate.tournamentId === score.tournamentId,
    );
    const was = previous?.total ?? 0;
    return {
      playerId: score.playerId,
      before: was,
      after: score.total,
      delta: score.total - was,
    };
  });
}

export function voidMatchOutcome(input: VoidMatchInput): WithdrawalRecord {
  assertVoidable(input.match, input.tournament);
  const reason = assertReason(input.reason);
  const voided = voidMatch(input.match, input.at);
  const remaining = [
    ...input.matches.filter((match) => match.id !== voided.id),
    voided,
  ];
  const playerIds = affectedPlayerIds(input.match);
  const rebuilt = rescoreTournament({
    tournament: input.tournament,
    players: input.players,
    matches: remaining,
    playerIds,
    at: input.at,
  });
  return {
    match: voided,
    tournamentId: input.tournament.id,
    reason,
    at: input.at,
    rebuilt,
    explanation: explain("match.voided", reason, {
      matchId: voided.id,
      tournamentId: input.tournament.id,
      rebuilt: playerIds,
      movements: withdrawalMovements(input.scores, rebuilt),
    }),
  };
}
