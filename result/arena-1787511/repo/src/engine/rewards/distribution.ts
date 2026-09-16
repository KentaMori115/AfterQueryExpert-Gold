import { InvalidArgumentError } from "../../errors.js";
import type { RankingEntry, RewardConfig } from "../../types.js";
import { allocationsFor, assertTiers, type PoolAllocation } from "../../domain/rewards/prize-pool.js";

export function distributePrizePool(
  entries: readonly RankingEntry[],
  config: RewardConfig,
): PoolAllocation[] {
  assertTiers(config.tiers);
  if (config.prizePool < 0) {
    throw new InvalidArgumentError("prize pool cannot be negative", { prizePool: config.prizePool });
  }
  return allocationsFor(entries, config);
}

export function totalDistributed(allocations: readonly PoolAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
}

export function byPlayer(allocations: readonly PoolAllocation[], playerId: string): PoolAllocation | undefined {
  return allocations.find((allocation) => allocation.playerId === playerId);
}
