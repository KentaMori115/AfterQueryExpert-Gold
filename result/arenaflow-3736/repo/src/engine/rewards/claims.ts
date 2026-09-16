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
