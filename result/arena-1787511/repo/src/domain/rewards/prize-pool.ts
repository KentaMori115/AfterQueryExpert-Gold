import { InvalidArgumentError } from "../../errors.js";
import type { RankingEntry, RewardConfig, RewardTierConfig } from "../../types.js";

export interface PoolAllocation {
  readonly playerId: string;
  readonly tier: string;
  readonly amount: number;
  readonly rank: number;
}

export function allocationsFor(
  entries: readonly RankingEntry[],
  config: RewardConfig,
): PoolAllocation[] {
  const allocations: PoolAllocation[] = [];
  for (const entry of entries) {
    const tier = tierForRank(entry.rank, config.tiers);
    if (!tier) {
      continue;
    }
    const amount = amountForTier(tier, config.prizePool);
    allocations.push({
      playerId: entry.playerId,
      tier: tier.name,
      amount,
      rank: entry.rank,
    });
  }
  return allocations;
}

export function tierForRank(
  rank: number,
  tiers: readonly RewardTierConfig[],
): RewardTierConfig | undefined {
  return tiers.find((tier) => rank >= tier.minRank && rank <= tier.maxRank);
}

export function amountForTier(tier: RewardTierConfig, prizePool: number): number {
  if (tier.shareOfPool !== undefined) {
    if (tier.shareOfPool < 0 || tier.shareOfPool > 1) {
      throw new InvalidArgumentError("shareOfPool must be between 0 and 1", { tier });
    }
    return prizePool * tier.shareOfPool;
  }
  return tier.amount;
}

/** What a set of allocations takes out of the pool. */
export function poolSpent(allocations: readonly PoolAllocation[]): number {
  return allocations.reduce((total, allocation) => total + allocation.amount, 0);
}

/**
 * What is left of a prize pool once the tiers have taken their share. A flat
 * tier can take more than the pool holds, so this goes negative rather than
 * clamping: an operator wants to see that a payout is over budget.
 */
export function poolRemainder(
  allocations: readonly PoolAllocation[],
  config: RewardConfig,
): number {
  return config.prizePool - poolSpent(allocations);
}

export function tierNames(config: RewardConfig): string[] {
  return config.tiers.map((tier) => tier.name);
}

export function assertTiers(tiers: readonly RewardTierConfig[]): void {
  for (const tier of tiers) {
    if (tier.minRank < 1 || tier.maxRank < tier.minRank) {
      throw new InvalidArgumentError("invalid reward tier range", { tier });
    }
  }
}
