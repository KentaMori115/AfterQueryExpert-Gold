import { ConflictError, IllegalStateError, NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { createPrefixedId } from "../../ids.js";
import { explain } from "../../explain.js";
import type { RankingEntry, RewardConfig, RewardRecord, TournamentId } from "../../types.js";
import { claimReward, grantReward, isClaimable, revokeReward } from "../../domain/rewards/reward.js";
import { assertClaimWindow } from "./claims.js";
import { FIRST_ROUND, roundSuffix } from "./recall.js";
import { distributePrizePool } from "./distribution.js";

export class RewardEngine {
  qualify(
    tournamentId: TournamentId,
    entries: readonly RankingEntry[],
    config: RewardConfig,
    at: EpochMillis,
    existing: readonly RewardRecord[] = [],
    round: number = FIRST_ROUND,
  ): RewardRecord[] {
    if (existing.some((reward) => reward.tournamentId === tournamentId && reward.status !== "revoked")) {
      throw new ConflictError("rewards already distributed for tournament", { tournamentId });
    }
    return distributePrizePool(entries, config).map((allocation) =>
      grantReward({
        id: createPrefixedId(
          "rwd",
          `${tournamentId}_${allocation.playerId}_${allocation.tier}${roundSuffix(round)}`,
        ),
        playerId: allocation.playerId,
        tournamentId,
        amount: allocation.amount,
        tier: allocation.tier,
        grantedAt: at,
        explanation: explain("reward.qualified", `qualified for ${allocation.tier}`, {
          rank: allocation.rank,
          amount: allocation.amount,
          round,
        }),
      }),
    );
  }

  claim(
    rewards: readonly RewardRecord[],
    rewardId: string,
    at: EpochMillis,
    claimWindowMs?: number,
  ): RewardRecord[] {
    const current = rewards.find((reward) => reward.id === rewardId);
    if (!current) {
      throw new NotFoundError("reward", rewardId);
    }
    if (!isClaimable(current)) {
      throw new IllegalStateError("reward cannot be claimed", { rewardId, status: current.status });
    }
    assertClaimWindow(current, at, claimWindowMs);
    return rewards.map((reward) => (reward.id === rewardId ? claimReward(reward, at) : reward));
  }

  /**
   * Take one reward back. A claimed prize is gone: the ledger says a person
   * has it, and rewriting that record would make the ledger lie.
   */
  revoke(rewards: readonly RewardRecord[], rewardId: string, reason: string): RewardRecord {
    const current = rewards.find((reward) => reward.id === rewardId);
    if (!current) {
      throw new NotFoundError("reward", rewardId);
    }
    if (current.status === "revoked") {
      throw new ConflictError("reward is already revoked", { rewardId });
    }
    if (current.status === "claimed") {
      throw new IllegalStateError("a claimed reward cannot be revoked", {
        rewardId,
        claimedAt: current.claimedAt,
      });
    }
    return revokeReward(current, reason);
  }

  forPlayer(rewards: readonly RewardRecord[], playerId: string): RewardRecord[] {
    return rewards.filter((reward) => reward.playerId === playerId);
  }
}

export const rewardEngine = new RewardEngine();
