import type { DecisionExplanation } from "../../explain.js";
import type { EpochMillis } from "../../clock.js";
import type { PlayerId, PlayerRecord } from "../../types.js";

export interface PlayerHistoryEntry {
  readonly at: EpochMillis;
  readonly kind: string;
  readonly summary: string;
  readonly explanation: DecisionExplanation | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PlayerProfile {
  readonly player: PlayerRecord;
  readonly tournamentsPlayed: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly forfeits: number;
  readonly totalScore: number;
  readonly rewardsGranted: number;
  readonly rewardsClaimed: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly lastActiveAt: EpochMillis | undefined;
  readonly history: readonly PlayerHistoryEntry[];
}

export function emptyProfile(player: PlayerRecord): PlayerProfile {
  return Object.freeze({
    player,
    tournamentsPlayed: 0,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    forfeits: 0,
    totalScore: 0,
    rewardsGranted: 0,
    rewardsClaimed: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastActiveAt: undefined,
    history: Object.freeze([]),
  });
}

export function appendHistory(
  profile: PlayerProfile,
  entry: PlayerHistoryEntry,
): PlayerProfile {
  return Object.freeze({
    ...profile,
    lastActiveAt: entry.at,
    history: Object.freeze([...profile.history, entry]),
  });
}

export function withMatchOutcome(
  profile: PlayerProfile,
  outcome: "win" | "loss" | "draw" | "forfeit",
  at: EpochMillis,
): PlayerProfile {
  const wins = profile.wins + (outcome === "win" ? 1 : 0);
  const losses = profile.losses + (outcome === "loss" ? 1 : 0);
  const draws = profile.draws + (outcome === "draw" ? 1 : 0);
  const forfeits = profile.forfeits + (outcome === "forfeit" ? 1 : 0);
  const currentStreak = outcome === "win" ? profile.currentStreak + 1 : 0;
  return Object.freeze({
    ...profile,
    matchesPlayed: profile.matchesPlayed + 1,
    wins,
    losses,
    draws,
    forfeits,
    currentStreak,
    bestStreak: Math.max(profile.bestStreak, currentStreak),
    lastActiveAt: at,
  });
}

export function winRate(profile: PlayerProfile): number {
  if (profile.matchesPlayed === 0) {
    return 0;
  }
  return profile.wins / profile.matchesPlayed;
}

export function profileFor(playerId: PlayerId, profiles: readonly PlayerProfile[]): PlayerProfile | undefined {
  return profiles.find((profile) => profile.player.id === playerId);
}
