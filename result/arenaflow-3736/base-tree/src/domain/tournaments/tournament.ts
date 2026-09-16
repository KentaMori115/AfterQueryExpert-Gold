import { InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId } from "../../ids.js";
import {
  DEFAULT_REWARDS,
  DEFAULT_RULES,
  DEFAULT_SCORING,
  type PlayerId,
  type RewardConfig,
  type RuleConfig,
  type ScoringConfig,
  type SeasonId,
  type TournamentFormat,
  type TournamentId,
  type TournamentRecord,
  type TournamentStatus,
} from "../../types.js";

export const TOURNAMENT_FORMATS: readonly TournamentFormat[] = [
  "leaderboard",
  "round_robin",
  "elimination",
  "team",
  "time_challenge",
];

export const TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  "draft",
  "registration",
  "active",
  "completed",
  "cancelled",
];

export interface CreateTournamentInput {
  readonly id: TournamentId;
  readonly name: string;
  readonly format: TournamentFormat;
  readonly createdAt: EpochMillis;
  readonly seasonId?: SeasonId;
  readonly capacity?: number;
  readonly scoring?: Partial<ScoringConfig>;
  readonly rules?: Partial<RuleConfig>;
  readonly rewards?: Partial<RewardConfig>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createTournament(input: CreateTournamentInput): TournamentRecord {
  const id = assertId(input.id, "tournament.id");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    throw new InvalidArgumentError("tournament name must be 2-80 characters", { name });
  }
  if (!TOURNAMENT_FORMATS.includes(input.format)) {
    throw new InvalidArgumentError("unsupported tournament format", { format: input.format });
  }
  const createdAt = assertEpochMillis(input.createdAt, "tournament.createdAt");
  const capacity = input.capacity ?? 64;
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 10000) {
    throw new InvalidArgumentError("capacity must be an integer between 2 and 10000", { capacity });
  }

  return Object.freeze({
    id,
    name,
    format: input.format,
    status: "draft",
    seasonId: input.seasonId,
    createdAt,
    startedAt: undefined,
    endedAt: undefined,
    capacity,
    registeredPlayerIds: Object.freeze([]),
    scoring: freezeScoring({ ...DEFAULT_SCORING, ...input.scoring }),
    rules: freezeRules({ ...DEFAULT_RULES, ...input.rules }),
    rewards: freezeRewards({ ...DEFAULT_REWARDS, ...input.rewards }),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

export function isRegistered(tournament: TournamentRecord, playerId: PlayerId): boolean {
  return tournament.registeredPlayerIds.includes(playerId);
}

export function remainingSlots(tournament: TournamentRecord): number {
  return tournament.capacity - tournament.registeredPlayerIds.length;
}

export function isFull(tournament: TournamentRecord): boolean {
  return remainingSlots(tournament) <= 0;
}

export function withStatus(
  tournament: TournamentRecord,
  status: TournamentStatus,
  at: EpochMillis,
): TournamentRecord {
  const startedAt = status === "active" ? (tournament.startedAt ?? at) : tournament.startedAt;
  const endedAt = status === "completed" || status === "cancelled" ? at : tournament.endedAt;
  return Object.freeze({ ...tournament, status, startedAt, endedAt });
}

export function withRegisteredPlayers(
  tournament: TournamentRecord,
  playerIds: readonly PlayerId[],
): TournamentRecord {
  const unique = [...new Set(playerIds)];
  if (unique.length > tournament.capacity) {
    throw new InvalidArgumentError("registered players exceed capacity", {
      capacity: tournament.capacity,
      count: unique.length,
    });
  }
  return Object.freeze({
    ...tournament,
    registeredPlayerIds: Object.freeze(unique),
  });
}

export function freezeScoring(scoring: ScoringConfig): ScoringConfig {
  if (!Number.isFinite(scoring.winPoints) || !Number.isFinite(scoring.lossPoints)) {
    throw new InvalidArgumentError("scoring points must be finite numbers", { scoring });
  }
  if (scoring.streakBonusEvery < 1) {
    throw new InvalidArgumentError("streakBonusEvery must be at least 1", { scoring });
  }
  if (scoring.vipMultiplier <= 0) {
    throw new InvalidArgumentError("vipMultiplier must be positive", { scoring });
  }
  return Object.freeze({ ...scoring });
}

export function freezeRules(rules: RuleConfig): RuleConfig {
  if (!Number.isInteger(rules.minLevel) || rules.minLevel < 1) {
    throw new InvalidArgumentError("minLevel must be a positive integer", { rules });
  }
  return Object.freeze({
    ...rules,
    bannedTags: Object.freeze([...rules.bannedTags]),
    allowedTags: Object.freeze([...rules.allowedTags]),
  });
}

export function freezeRewards(rewards: RewardConfig): RewardConfig {
  if (rewards.prizePool < 0) {
    throw new InvalidArgumentError("prize pool cannot be negative", { rewards });
  }
  return Object.freeze({
    ...rewards,
    tiers: Object.freeze(rewards.tiers.map((tier) => Object.freeze({ ...tier }))),
  });
}
