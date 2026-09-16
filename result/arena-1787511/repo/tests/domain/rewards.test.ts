import { describe, expect, it } from "vitest";
import { IllegalStateError } from "../../src/errors.js";
import { ranksFromScores } from "../../src/domain/rankings/index.js";
import { applyScoreDelta, emptyScore } from "../../src/domain/scores/index.js";
import { explain } from "../../src/explain.js";
import {
  allocationsFor,
  claimReward,
  grantReward,
  isClaimable,
  revokeReward,
} from "../../src/domain/rewards/index.js";

const T0 = 1_700_000_500_000;

describe("reward domain", () => {
  it("grants, claims, and revokes rewards", () => {
    const reward = grantReward({
      playerId: "plr_a",
      tournamentId: "tnm_cup",
      amount: 250,
      tier: "gold",
      grantedAt: T0,
    });
    expect(isClaimable(reward)).toBe(true);
    const claimed = claimReward(reward, T0 + 1);
    expect(claimed.status).toBe("claimed");
    expect(() => claimReward(claimed, T0 + 2)).toThrow(IllegalStateError);
    const revoked = revokeReward(reward, "anti-cheat");
    expect(revoked.status).toBe("revoked");
  });

  it("allocates prize pool by rank tiers", () => {
    const a = applyScoreDelta(emptyScore("plr_a", "tnm", T0), 200, T0 + 1, explain("s", "s"), "win");
    const b = applyScoreDelta(emptyScore("plr_b", "tnm", T0), 100, T0 + 2, explain("s", "s"), "win");
    const ranks = ranksFromScores("tnm", [a, b]);
    const allocations = allocationsFor(ranks.entries, {
      prizePool: 1000,
      claimWindowMs: undefined,
      tiers: [
        { name: "gold", minRank: 1, maxRank: 1, amount: 0, shareOfPool: 0.7 },
        { name: "silver", minRank: 2, maxRank: 2, amount: 0, shareOfPool: 0.3 },
      ],
    });
    expect(allocations).toEqual([
      { playerId: "plr_a", tier: "gold", amount: 700, rank: 1 },
      { playerId: "plr_b", tier: "silver", amount: 300, rank: 2 },
    ]);
  });
});
