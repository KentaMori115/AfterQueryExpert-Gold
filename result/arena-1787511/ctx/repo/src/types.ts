import type { EpochMillis } from "./clock.js";
import type { DecisionExplanation } from "./explain.js";

export type PlayerId = string;
export type TournamentId = string;
export type MatchId = string;
export type SeasonId = string;
export type RewardId = string;
export type TeamId = string;
export type EventId = string;
export type SnapshotId = string;
export type PrizePoolId = string;

export type TournamentFormat =
  | "leaderboard"
  | "round_robin"
  | "elimination"
  | "team"
  | "time_challenge";

export type TournamentStatus = "draft" | "registration" | "active" | "completed" | "cancelled";

export type MatchStatus = "pending" | "started" | "completed" | "voided";

export type MatchOutcome = "win" | "loss" | "draw" | "forfeit";

export type SeasonStatus = "upcoming" | "active" | "closed";

export type RewardStatus = "pending" | "granted" | "claimed" | "revoked";

export type AntiCheatSeverity = "info" | "warning" | "block";

export interface PlayerRecord {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly createdAt: EpochMillis;
  readonly skillRating: number;
  readonly level: number;
  readonly vip: boolean;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface TournamentRecord {
  readonly id: TournamentId;
  readonly name: string;
  readonly format: TournamentFormat;
  readonly status: TournamentStatus;
  readonly seasonId: SeasonId | undefined;
  readonly createdAt: EpochMillis;
  readonly startedAt: EpochMillis | undefined;
  readonly endedAt: EpochMillis | undefined;
  readonly capacity: number;
  readonly registeredPlayerIds: readonly PlayerId[];
  readonly scoring: ScoringConfig;
  readonly rules: RuleConfig;
  readonly rewards: RewardConfig;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ScoringConfig {
  readonly winPoints: number;
  readonly lossPoints: number;
  readonly drawPoints: number;
  readonly forfeitPoints: number;
  readonly streakBonusEvery: number;
  readonly streakBonusPoints: number;
  readonly vipMultiplier: number;
  readonly customFormula: string | undefined;
}

export interface RuleConfig {
  readonly minLevel: number;
  readonly maxLevel: number | undefined;
  readonly requireVip: boolean;
  readonly bannedTags: readonly string[];
  readonly allowedTags: readonly string[];
  readonly maxMatchesPerPlayer: number | undefined;
}

export interface RewardConfig {
  readonly prizePool: number;
  readonly tiers: readonly RewardTierConfig[];
  readonly claimWindowMs: number | undefined;
}

export interface RewardTierConfig {
  readonly name: string;
  readonly minRank: number;
  readonly maxRank: number;
  readonly amount: number;
  readonly shareOfPool: number | undefined;
}

export interface MatchRecord {
  readonly id: MatchId;
  readonly tournamentId: TournamentId;
  readonly playerIds: readonly PlayerId[];
  readonly teamIds: readonly TeamId[];
  readonly status: MatchStatus;
  readonly createdAt: EpochMillis;
  readonly startedAt: EpochMillis | undefined;
  readonly completedAt: EpochMillis | undefined;
  readonly results: readonly MatchResultRecord[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MatchResultRecord {
  readonly playerId: PlayerId;
  readonly outcome: MatchOutcome;
  readonly rawScore: number;
  readonly placement: number | undefined;
}

export interface ScoreRecord {
  readonly playerId: PlayerId;
  readonly tournamentId: TournamentId;
  readonly total: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly lastUpdatedAt: EpochMillis;
  readonly explanations: readonly DecisionExplanation[];
}

export interface RankingEntry {
  readonly playerId: PlayerId;
  readonly tournamentId: TournamentId;
  readonly rank: number;
  readonly score: number;
  readonly tieBreakScore: number;
  readonly previousRank: number | undefined;
  readonly movement: number;
  readonly explanation: DecisionExplanation;
}

export interface RewardRecord {
  readonly id: RewardId;
  readonly playerId: PlayerId;
  readonly tournamentId: TournamentId;
  readonly seasonId: SeasonId | undefined;
  readonly amount: number;
  readonly tier: string;
  readonly status: RewardStatus;
  readonly grantedAt: EpochMillis;
  readonly claimedAt: EpochMillis | undefined;
  readonly explanation: DecisionExplanation;
}

export interface SeasonRecord {
  readonly id: SeasonId;
  readonly name: string;
  readonly status: SeasonStatus;
  readonly startsAt: EpochMillis;
  readonly endsAt: EpochMillis;
  readonly resetRanksOnClose: boolean;
  readonly createdAt: EpochMillis;
}

export const DEFAULT_SCORING: ScoringConfig = {
  winPoints: 100,
  lossPoints: -20,
  drawPoints: 10,
  forfeitPoints: -40,
  streakBonusEvery: 5,
  streakBonusPoints: 50,
  vipMultiplier: 1.1,
  customFormula: undefined,
};

export const DEFAULT_RULES: RuleConfig = {
  minLevel: 1,
  maxLevel: undefined,
  requireVip: false,
  bannedTags: [],
  allowedTags: [],
  maxMatchesPerPlayer: undefined,
};

export const DEFAULT_REWARDS: RewardConfig = {
  prizePool: 0,
  tiers: [],
  claimWindowMs: undefined,
};
