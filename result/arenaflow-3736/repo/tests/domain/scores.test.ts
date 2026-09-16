import { describe, expect, it } from "vitest";
import { explain } from "../../src/explain.js";
import {
  applyScoreDelta,
  applyVipMultiplier,
  basePointsFor,
  compareScores,
  emptyScore,
  evaluateCustomFormula,
  streakBonus,
} from "../../src/domain/scores/index.js";
import { DEFAULT_SCORING } from "../../src/types.js";

const T0 = 1_700_000_300_000;

describe("score domain", () => {
  it("applies deltas and tracks streaks", () => {
    let score = emptyScore("plr_a", "tnm_cup", T0);
    score = applyScoreDelta(score, 100, T0 + 1, explain("win", "win"), "win");
    score = applyScoreDelta(score, 100, T0 + 2, explain("win", "win"), "win");
    score = applyScoreDelta(score, -20, T0 + 3, explain("loss", "loss"), "loss");
    expect(score.total).toBe(180);
    expect(score.wins).toBe(2);
    expect(score.losses).toBe(1);
    expect(score.streak).toBe(0);
    expect(score.bestStreak).toBe(2);
  });

  it("orders by total, wins, streak, then time", () => {
    const a = applyScoreDelta(emptyScore("plr_a", "tnm", T0), 100, T0 + 2, explain("w", "w"), "win");
    const b = applyScoreDelta(emptyScore("plr_b", "tnm", T0), 100, T0 + 1, explain("w", "w"), "win");
    expect(compareScores(a, b)).toBeGreaterThan(0);
  });

  it("computes default formula pieces", () => {
    expect(basePointsFor("win", DEFAULT_SCORING)).toBe(100);
    expect(basePointsFor("loss", DEFAULT_SCORING)).toBe(-20);
    expect(streakBonus(5, DEFAULT_SCORING)).toBe(50);
    expect(streakBonus(4, DEFAULT_SCORING)).toBe(0);
    expect(applyVipMultiplier(100, true, DEFAULT_SCORING)).toBeCloseTo(110);
  });

  it("evaluates a custom formula deterministically", () => {
    const value = evaluateCustomFormula("BASE + RAW + STREAK", {
      outcome: "win",
      rawScore: 7,
      streak: 3,
      vip: false,
      config: DEFAULT_SCORING,
    });
    expect(value).toBe(110);
  });
});
