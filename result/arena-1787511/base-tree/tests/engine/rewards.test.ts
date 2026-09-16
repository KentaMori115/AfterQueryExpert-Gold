import { describe, expect, it } from "vitest";
import { ConflictError } from "../../src/errors.js";
import { explain } from "../../src/explain.js";
import { applyScoreDelta, emptyScore } from "../../src/domain/scores/index.js";
import { rankingEngine } from "../../src/engine/ranking/index.js";
import { canClaim, claimedTotal, pendingTotal, rewardEngine } from "../../src/engine/rewards/index.js";

const T0 = 1_700_001_400_000;

describe("reward engine", () => {
  it("distributes prize tiers and tracks claims", () => {
    const scores = [
      applyScoreDelta(emptyScore("plr_a", "tnm_cup", T0), 200, T0 + 1, explain("s", "s"), "win"),
      applyScoreDelta(emptyScore("plr_b", "tnm_cup", T0), 50, T0 + 2, explain("s", "s"), "win"),
    ];
    const entries = rankingEngine.compute("tnm_cup", scores).entries;
    const granted = rewardEngine.qualify(
      "tnm_cup",
      entries,
      {
        prizePool: 1000,
        claimWindowMs: 1000,
        tiers: [
          { name: "gold", minRank: 1, maxRank: 1, amount: 700, shareOfPool: undefined },
          { name: "silver", minRank: 2, maxRank: 2, amount: 300, shareOfPool: undefined },
        ],
      },
      T0 + 3,
    );
    expect(granted.map((reward) => reward.amount)).toEqual([700, 300]);
    expect(pendingTotal(granted, "plr_a")).toBe(700);
    expect(canClaim(granted[0]!, T0 + 4, 1000)).toBe(true);
    const claimed = rewardEngine.claim(granted, granted[0]!.id, T0 + 4);
    expect(claimedTotal(claimed, "plr_a")).toBe(700);
    expect(() => rewardEngine.qualify("tnm_cup", entries, { prizePool: 1, tiers: [], claimWindowMs: undefined }, T0, granted)).toThrow(
      ConflictError,
    );
  });
});
