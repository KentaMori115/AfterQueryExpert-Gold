import { type Fixed } from "@biomeweaver/fixed-point";
import { liveClaims, outstanding, rationPool } from "./rationing.js";
import { compareKeys, sortedKeys, type ClaimSlate, type SettledClaim } from "./types.js";

/**
 * Settle every claim on the slate together.
 *
 * A round offers each prey cohort what it still holds to the claims still
 * wanting it, trims each capped predator's collected offers to what is left of
 * its budget, and takes what survives. Prey freed by a trim is back on the
 * table next round. A round that moves nothing ends the settlement, which
 * happens once every prey is empty, every budget is spent, or every claim has
 * what it asked for.
 */
export function settleClaims(slate: ClaimSlate): SettledClaim[] {
  const order = [...slate.claims].map((claim) => claim.key).sort(compareKeys);
  const granted = new Map<string, Fixed>(slate.claims.map((claim) => [claim.key, 0n]));
  const left = new Map<string, Fixed>(slate.availability);
  const budget = new Map<string, Fixed>(slate.budgets);

  for (;;) {
    const live = liveClaims(slate.claims, granted, left, budget);
    if (live.length === 0) {
      break;
    }

    const wanted = new Map<string, Fixed>(
      live.map((claim) => [claim.key, outstanding(claim, granted)]),
    );
    const offer = new Map<string, Fixed>();
    for (const preyKey of sortedKeys(live.map((claim) => claim.preyKey))) {
      const rows = live
        .filter((claim) => claim.preyKey === preyKey)
        .sort((one, other) => compareKeys(one.key, other.key));
      for (const [key, amount] of rationPool(rows, wanted, left.get(preyKey) ?? 0n, order)) {
        offer.set(key, amount);
      }
    }

    for (const predatorKey of sortedKeys(live.map((claim) => claim.predatorKey))) {
      const cap = budget.get(predatorKey);
      if (cap === undefined) {
        continue;
      }
      const rows = live
        .filter((claim) => claim.predatorKey === predatorKey)
        .sort((one, other) => compareKeys(one.key, other.key));
      for (const [key, amount] of rationPool(rows, offer, cap, order)) {
        offer.set(key, amount);
      }
    }

    let moved = 0n;
    for (const claim of live) {
      const amount = offer.get(claim.key) ?? 0n;
      if (amount <= 0n) {
        continue;
      }
      granted.set(claim.key, (granted.get(claim.key) ?? 0n) + amount);
      left.set(claim.preyKey, (left.get(claim.preyKey) ?? 0n) - amount);
      const cap = budget.get(claim.predatorKey);
      if (cap !== undefined) {
        budget.set(claim.predatorKey, cap - amount);
      }
      moved += amount;
    }
    if (moved === 0n) {
      break;
    }
  }

  return slate.claims.map((claim) => ({ key: claim.key, granted: granted.get(claim.key) ?? 0n }));
}
