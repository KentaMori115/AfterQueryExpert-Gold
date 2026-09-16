import { IllegalStateError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import type { RewardRecord } from "../../types.js";

export function canClaim(reward: RewardRecord, at: EpochMillis, claimWindowMs?: number): boolean {
  if (reward.status !== "granted") {
    return false;
  }
  if (claimWindowMs === undefined) {
    return true;
  }
  return at <= reward.grantedAt + claimWindowMs;
}

export function assertClaimWindow(reward: RewardRecord, at: EpochMillis, claimWindowMs?: number): void {
  if (!canClaim(reward, at, claimWindowMs)) {
    throw new IllegalStateError("reward claim window has closed or reward is not granted", {
      rewardId: reward.id,
      status: reward.status,
      grantedAt: reward.grantedAt,
      at,
      claimWindowMs,
    });
  }
}

/** When a granted reward stops being claimable, if it ever does. */
export function claimDeadline(
  reward: RewardRecord,
  claimWindowMs?: number,
): EpochMillis | undefined {
  return claimWindowMs === undefined ? undefined : reward.grantedAt + claimWindowMs;
}

export function isExpired(reward: RewardRecord, at: EpochMillis, claimWindowMs?: number): boolean {
  const deadline = claimDeadline(reward, claimWindowMs);
  return deadline !== undefined && at > deadline;
}

export interface RewardBalance {
  readonly playerId: string;
  readonly claimed: number;
  readonly pending: number;
}

/**
 * What a player has been paid and what is still waiting for them. Revoked
 * rewards count towards neither: a recall leaves the ledger holding the
 * record and the balance holding nothing.
 */
export function rewardBalance(rewards: readonly RewardRecord[], playerId: string): RewardBalance {
  return {
    playerId,
    claimed: claimedTotal(rewards, playerId),
    pending: pendingTotal(rewards, playerId),
  };
}

export function claimedTotal(rewards: readonly RewardRecord[], playerId: string): number {
  return rewards
    .filter((reward) => reward.playerId === playerId && reward.status === "claimed")
    .reduce((sum, reward) => sum + reward.amount, 0);
}

export function pendingTotal(rewards: readonly RewardRecord[], playerId: string): number {
  return rewards
    .filter((reward) => reward.playerId === playerId && reward.status === "granted")
    .reduce((sum, reward) => sum + reward.amount, 0);
}
