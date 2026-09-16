import { assignRemainders, proportionalShares, type Fixed } from "@biomeweaver/fixed-point";
import { type PredationClaim } from "./types.js";

/**
 * Split one pool across the claims that want it.
 *
 * Claims that together want no more than the pool holds are offered what they
 * asked for. Anything tighter than that is shared out in proportion to the
 * asks, with the units left over by the division handed round the claims in
 * ascending key order.
 */
export function rationPool(
  rows: readonly PredationClaim[],
  wanted: ReadonlyMap<string, Fixed>,
  pool: Fixed,
  order: readonly string[],
): Map<string, Fixed> {
  const offered = new Map<string, Fixed>();
  const asked = rows.reduce((sum, row) => sum + (wanted.get(row.key) ?? 0n), 0n);
  if (asked <= pool) {
    for (const row of rows) {
      offered.set(row.key, wanted.get(row.key) ?? 0n);
    }
    return offered;
  }
  const shares = proportionalShares(
    rows.map((row) => ({ key: row.key, amount: wanted.get(row.key) ?? 0n })),
    pool,
  );
  for (const share of assignRemainders(shares.assigned, shares.remainder, order)) {
    offered.set(share.key, share.amount);
  }
  return offered;
}

/**
 * What a claim still wants: its ask less whatever earlier rounds handed it.
 */
export function outstanding(claim: PredationClaim, granted: ReadonlyMap<string, Fixed>): Fixed {
  const taken = granted.get(claim.key) ?? 0n;
  return claim.ask > taken ? claim.ask - taken : 0n;
}

/**
 * Claims worth another round: the prey still holds something, the predator has
 * budget left, and the claim itself is not yet satisfied.
 */
export function liveClaims(
  claims: readonly PredationClaim[],
  granted: ReadonlyMap<string, Fixed>,
  left: ReadonlyMap<string, Fixed>,
  budget: ReadonlyMap<string, Fixed>,
): PredationClaim[] {
  return claims.filter((claim) => {
    if (outstanding(claim, granted) <= 0n) {
      return false;
    }
    if ((left.get(claim.preyKey) ?? 0n) <= 0n) {
      return false;
    }
    const cap = budget.get(claim.predatorKey);
    return cap === undefined || cap > 0n;
  });
}
