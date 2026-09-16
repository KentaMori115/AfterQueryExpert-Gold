import { ConflictError, IllegalStateError, NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { createPrefixedId } from "../../ids.js";
import { explain } from "../../explain.js";
import type { RankingEntry, RewardConfig, RewardRecord, TournamentId } from "../../types.js";
import { claimReward, grantReward, isClaimable } from "../../domain/rewards/reward.js";
import { distributePrizePool } from "./distribution.js";

export class RewardEngine {
  qualify(
    tournamentId: TournamentId,
    entries: readonly RankingEntry[],
    config: RewardConfig,
    at: EpochMillis,
    existing: readonly RewardRecord[] = [],
  ): RewardRecord[] {
    if (existing.some((reward) => reward.tournamentId === tournamentId && reward.status !== "revoked")) {
      throw new ConflictError("rewards already distributed for tournament", { tournamentId });
    }
    return distributePrizePool(entries, config).map((allocation) =>
      grantReward({
        id: createPrefixedId("rwd", `${tournamentId}_${allocation.playerId}_${allocation.tier}`),
        playerId: allocation.playerId,
        tournamentId,
        amount: allocation.amount,
        tier: allocation.tier,
        grantedAt: at,
        explanation: explain("reward.qualified", `qualified for ${allocation.tier}`, {
          rank: allocation.rank,
          amount: allocation.amount,
        }),
      }),
    );
  }

  claim(rewards: readonly RewardRecord[], rewardId: string, at: EpochMillis): RewardRecord[] {
    const current = rewards.find((reward) => reward.id === rewardId);
    if (!current) {
      throw new NotFoundError("reward", rewardId);
    }
    if (!isClaimable(current)) {
      throw new IllegalStateError("reward cannot be claimed", { rewardId, status: current.status });
    }
    return rewards.map((reward) => (reward.id === rewardId ? claimReward(reward, at) : reward));
  }

  forPlayer(rewards: readonly RewardRecord[], playerId: string): RewardRecord[] {
    return rewards.filter((reward) => reward.playerId === playerId);
  }
}

export const rewardEngine = new RewardEngine();
