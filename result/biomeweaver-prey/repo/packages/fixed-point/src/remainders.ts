import { type Fixed } from "./types.js";

export type RemainderShare = {
  readonly key: string;
  readonly amount: Fixed;
};

export function assignRemainders(
  shares: readonly RemainderShare[],
  remainder: Fixed,
  order: readonly string[],
): readonly RemainderShare[] {
  if (remainder === 0n || shares.length === 0) {
    return shares.map((share) => ({ key: share.key, amount: share.amount }));
  }
  const rank = new Map<string, number>();
  for (const [index, key] of order.entries()) {
    rank.set(key, index);
  }
  const sorted = [...shares].sort((left, right) => {
    const leftRank = rank.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.key.localeCompare(right.key);
  });
  const extra = new Map<string, Fixed>();
  let remaining = remainder;
  let index = 0;
  while (remaining > 0n && sorted.length > 0) {
    const share = sorted[index % sorted.length];
    if (share) {
      extra.set(share.key, (extra.get(share.key) ?? 0n) + 1n);
      remaining -= 1n;
    }
    index += 1;
  }
  return shares.map((share) => ({
    key: share.key,
    amount: share.amount + (extra.get(share.key) ?? 0n),
  }));
}

export function proportionalShares(
  weights: readonly RemainderShare[],
  total: Fixed,
): { readonly assigned: readonly RemainderShare[]; readonly remainder: Fixed } {
  const weightSum = weights.reduce((sum, item) => sum + item.amount, 0n);
  if (weightSum === 0n || total === 0n) {
    return {
      assigned: weights.map((item) => ({ key: item.key, amount: 0n })),
      remainder: total,
    };
  }
  const assigned = weights.map((item) => ({
    key: item.key,
    amount: (total * item.amount) / weightSum,
  }));
  const used = assigned.reduce((sum, item) => sum + item.amount, 0n);
  return { assigned, remainder: total - used };
}
