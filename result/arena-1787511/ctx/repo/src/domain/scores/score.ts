import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId } from "../../ids.js";
import type { DecisionExplanation } from "../../explain.js";
import type { PlayerId, ScoreRecord, TournamentId } from "../../types.js";

export function emptyScore(
  playerId: PlayerId,
  tournamentId: TournamentId,
  at: EpochMillis,
): ScoreRecord {
  return Object.freeze({
    playerId: assertId(playerId, "score.playerId"),
    tournamentId: assertId(tournamentId, "score.tournamentId"),
    total: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    streak: 0,
    bestStreak: 0,
    lastUpdatedAt: assertEpochMillis(at, "score.at"),
    explanations: Object.freeze([]),
  });
}

export function applyScoreDelta(
  score: ScoreRecord,
  delta: number,
  at: EpochMillis,
  explanation: DecisionExplanation,
  outcome?: "win" | "loss" | "draw" | "forfeit",
): ScoreRecord {
  const streak = outcome === "win" ? score.streak + 1 : outcome ? 0 : score.streak;
  return Object.freeze({
    ...score,
    total: score.total + delta,
    wins: score.wins + (outcome === "win" ? 1 : 0),
    losses: score.losses + (outcome === "loss" || outcome === "forfeit" ? 1 : 0),
    draws: score.draws + (outcome === "draw" ? 1 : 0),
    streak,
    bestStreak: Math.max(score.bestStreak, streak),
    lastUpdatedAt: assertEpochMillis(at, "score.at"),
    explanations: Object.freeze([...score.explanations, explanation]),
  });
}

export function compareScores(a: ScoreRecord, b: ScoreRecord): number {
  if (a.total !== b.total) {
    return b.total - a.total;
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

export function scoreMapKey(playerId: PlayerId, tournamentId: TournamentId): string {
  return `${tournamentId}::${playerId}`;
}
