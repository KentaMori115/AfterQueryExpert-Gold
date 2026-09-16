import type { EpochMillis } from "../clock.js";
import type { DecisionExplanation } from "../explain.js";
import type {
  EventId,
  MatchId,
  MatchOutcome,
  PlayerId,
  RewardId,
  SeasonId,
  TournamentFormat,
  TournamentId,
} from "../types.js";

export type DomainEventType =
  | "PlayerCreated"
  | "PlayerRegistered"
  | "PlayerUnregistered"
  | "TournamentCreated"
  | "TournamentOpened"
  | "TournamentStarted"
  | "TournamentEnded"
  | "TournamentCancelled"
  | "MatchCreated"
  | "MatchStarted"
  | "ScoreSubmitted"
  | "MatchCompleted"
  | "MatchVoided"
  | "PenaltyApplied"
  | "RewardGranted"
  | "RewardClaimed"
  | "RewardRevoked"
  | "SeasonOpened"
  | "SeasonClosed"
  | "SnapshotTaken"
  | "AntiCheatFlagged";

export interface DomainEventBase<TType extends DomainEventType, TPayload> {
  readonly id: EventId;
  readonly type: TType;
  readonly at: EpochMillis;
  readonly streamId: string;
  readonly sequence: number;
  readonly payload: TPayload;
  readonly explanation: DecisionExplanation;
}

export type PlayerCreatedEvent = DomainEventBase<
  "PlayerCreated",
  { playerId: PlayerId; displayName: string; skillRating: number; level: number; vip: boolean }
>;

export type PlayerRegisteredEvent = DomainEventBase<
  "PlayerRegistered",
  { playerId: PlayerId; tournamentId: TournamentId }
>;

export type PlayerUnregisteredEvent = DomainEventBase<
  "PlayerUnregistered",
  { playerId: PlayerId; tournamentId: TournamentId }
>;

export type TournamentCreatedEvent = DomainEventBase<
  "TournamentCreated",
  { tournamentId: TournamentId; name: string; format: TournamentFormat; seasonId?: SeasonId }
>;

export type TournamentOpenedEvent = DomainEventBase<"TournamentOpened", { tournamentId: TournamentId }>;
export type TournamentStartedEvent = DomainEventBase<"TournamentStarted", { tournamentId: TournamentId }>;
export type TournamentEndedEvent = DomainEventBase<"TournamentEnded", { tournamentId: TournamentId }>;
export type TournamentCancelledEvent = DomainEventBase<
  "TournamentCancelled",
  { tournamentId: TournamentId; reason: string }
>;

export type MatchCreatedEvent = DomainEventBase<
  "MatchCreated",
  { matchId: MatchId; tournamentId: TournamentId; playerIds: readonly PlayerId[] }
>;

export type MatchStartedEvent = DomainEventBase<
  "MatchStarted",
  { matchId: MatchId; tournamentId: TournamentId }
>;

export type ScoreSubmittedEvent = DomainEventBase<
  "ScoreSubmitted",
  {
    matchId: MatchId;
    tournamentId: TournamentId;
    playerId: PlayerId;
    outcome: MatchOutcome;
    rawScore: number;
    awarded: number;
  }
>;

export type MatchCompletedEvent = DomainEventBase<
  "MatchCompleted",
  { matchId: MatchId; tournamentId: TournamentId }
>;

export type MatchVoidedEvent = DomainEventBase<
  "MatchVoided",
  { matchId: MatchId; tournamentId: TournamentId; reason: string }
>;

export type PenaltyAppliedEvent = DomainEventBase<
  "PenaltyApplied",
  { playerId: PlayerId; tournamentId: TournamentId; amount: number; reason: string }
>;

export type RewardGrantedEvent = DomainEventBase<
  "RewardGranted",
  { rewardId: RewardId; playerId: PlayerId; tournamentId: TournamentId; amount: number; tier: string }
>;

export type RewardClaimedEvent = DomainEventBase<
  "RewardClaimed",
  { rewardId: RewardId; playerId: PlayerId }
>;

export type RewardRevokedEvent = DomainEventBase<
  "RewardRevoked",
  { rewardId: RewardId; playerId: PlayerId; reason: string }
>;

export type SeasonOpenedEvent = DomainEventBase<"SeasonOpened", { seasonId: SeasonId }>;
export type SeasonClosedEvent = DomainEventBase<"SeasonClosed", { seasonId: SeasonId }>;
export type SnapshotTakenEvent = DomainEventBase<"SnapshotTaken", { snapshotId: string; lastSequence: number }>;

export type AntiCheatFlaggedEvent = DomainEventBase<
  "AntiCheatFlagged",
  { playerId: PlayerId; tournamentId: TournamentId | undefined; code: string; severity: string }
>;

export type DomainEvent =
  | PlayerCreatedEvent
  | PlayerRegisteredEvent
  | PlayerUnregisteredEvent
  | TournamentCreatedEvent
  | TournamentOpenedEvent
  | TournamentStartedEvent
  | TournamentEndedEvent
  | TournamentCancelledEvent
  | MatchCreatedEvent
  | MatchStartedEvent
  | ScoreSubmittedEvent
  | MatchCompletedEvent
  | MatchVoidedEvent
  | PenaltyAppliedEvent
  | RewardGrantedEvent
  | RewardClaimedEvent
  | RewardRevokedEvent
  | SeasonOpenedEvent
  | SeasonClosedEvent
  | SnapshotTakenEvent
  | AntiCheatFlaggedEvent;

export type EventPayloadOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>["payload"];
