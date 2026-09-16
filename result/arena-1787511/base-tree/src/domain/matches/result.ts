import { InvalidArgumentError } from "../../errors.js";
import type { MatchOutcome, MatchRecord, MatchResultRecord, PlayerId } from "../../types.js";

export const MATCH_OUTCOMES: readonly MatchOutcome[] = ["win", "loss", "draw", "forfeit"];

export interface PairResultInput {
  readonly winnerId: PlayerId;
  readonly loserId: PlayerId;
  readonly winnerScore?: number;
  readonly loserScore?: number;
}

export function pairResult(input: PairResultInput): MatchResultRecord[] {
  if (input.winnerId === input.loserId) {
    throw new InvalidArgumentError("winner and loser must be different players", {
      winnerId: input.winnerId,
      loserId: input.loserId,
    });
  }
  return [
    Object.freeze({
      playerId: input.winnerId,
      outcome: "win",
      rawScore: input.winnerScore ?? 1,
      placement: 1,
    }),
    Object.freeze({
      playerId: input.loserId,
      outcome: "loss",
      rawScore: input.loserScore ?? 0,
      placement: 2,
    }),
  ];
}

export function drawResult(playerIds: readonly PlayerId[], rawScore = 0): MatchResultRecord[] {
  if (playerIds.length < 2) {
    throw new InvalidArgumentError("draw requires at least two players", { playerIds });
  }
  return playerIds.map((playerId) =>
    Object.freeze({
      playerId,
      outcome: "draw" as const,
      rawScore,
      placement: 1,
    }),
  );
}

export function placementResults(
  placements: readonly { playerId: PlayerId; rawScore: number; placement: number }[],
): MatchResultRecord[] {
  const sorted = [...placements].sort((a, b) => a.placement - b.placement);
  return sorted.map((entry, index) =>
    Object.freeze({
      playerId: entry.playerId,
      outcome: index === 0 ? ("win" as const) : ("loss" as const),
      rawScore: entry.rawScore,
      placement: entry.placement,
    }),
  );
}

export function resultFor(match: MatchRecord, playerId: PlayerId): MatchResultRecord | undefined {
  return match.results.find((result) => result.playerId === playerId);
}

export function winners(match: MatchRecord): PlayerId[] {
  return match.results.filter((result) => result.outcome === "win").map((result) => result.playerId);
}

export function assertOutcome(value: string): MatchOutcome {
  if (!MATCH_OUTCOMES.includes(value as MatchOutcome)) {
    throw new InvalidArgumentError("unknown match outcome", { value });
  }
  return value as MatchOutcome;
}
