import { IllegalStateError, InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId, createPrefixedId } from "../../ids.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type {
  PlayerId,
  RewardId,
  RewardRecord,
  RewardStatus,
  SeasonId,
  TournamentId,
} from "../../types.js";

export interface GrantRewardInput {
  readonly id?: RewardId;
  readonly playerId: PlayerId;
  readonly tournamentId: TournamentId;
  readonly amount: number;
  readonly tier: string;
  readonly grantedAt: EpochMillis;
  readonly seasonId?: SeasonId;
  readonly explanation?: DecisionExplanation;
}

export function grantReward(input: GrantRewardInput): RewardRecord {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new InvalidArgumentError("reward amount must be a non-negative finite number", {
      amount: input.amount,
    });
  }
  const grantedAt = assertEpochMillis(input.grantedAt, "reward.grantedAt");
  const id = input.id ?? createPrefixedId("rwd", `${input.tournamentId}_${input.playerId}_${input.tier}`);
  return Object.freeze({
    id: assertId(id, "reward.id"),
    playerId: assertId(input.playerId, "reward.playerId"),
    tournamentId: assertId(input.tournamentId, "reward.tournamentId"),
    seasonId: input.seasonId,
    amount: input.amount,
    tier: input.tier.trim() || "unspecified",
    status: "granted",
    grantedAt,
    claimedAt: undefined,
    explanation:
      input.explanation ??
      explain("reward.granted", `granted ${input.amount} in tier ${input.tier}`, {
        playerId: input.playerId,
        tournamentId: input.tournamentId,
        amount: input.amount,
        tier: input.tier,
      }),
  });
}

export function claimReward(reward: RewardRecord, at: EpochMillis): RewardRecord {
  assertEpochMillis(at, "reward.claimedAt");
  if (reward.status !== "granted") {
    throw new IllegalStateError("only granted rewards can be claimed", {
      id: reward.id,
      status: reward.status,
    });
  }
  return Object.freeze({
    ...reward,
    status: "claimed" satisfies RewardStatus,
    claimedAt: at,
  });
}

export function revokeReward(reward: RewardRecord, reason: string): RewardRecord {
  if (reward.status === "revoked") {
    throw new IllegalStateError("reward already revoked", { id: reward.id });
  }
  return Object.freeze({
    ...reward,
    status: "revoked" satisfies RewardStatus,
    explanation: explain("reward.revoked", reason, { id: reward.id, previous: reward.status }),
  });
}

export function isClaimable(reward: RewardRecord): boolean {
  return reward.status === "granted";
}
