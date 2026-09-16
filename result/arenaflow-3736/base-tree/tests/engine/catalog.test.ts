import { describe, expect, it } from "vitest";
import { scoringEngine, scoringPreset, presetNames } from "../../src/engine/scoring/index.js";
import { createPlayer } from "../../src/domain/players/index.js";
import { createTournament } from "../../src/domain/tournaments/index.js";
import { lateSubmissionPenalty, manualPenalty, unsportsmanlikePenalty } from "../../src/engine/scoring/penalties.js";
import { perfectGameBonus, sumBonuses, winStreakBonus } from "../../src/engine/scoring/bonuses.js";
import { DEFAULT_SCORING } from "../../src/types.js";
import { remainingSlots, isFull } from "../../src/domain/tournaments/index.js";
import { movementLabel } from "../../src/domain/rankings/index.js";
import { explain } from "../../src/explain.js";

const T0 = 1_700_002_300_000;

describe("scoring presets and catalog", () => {
  it("lists presets", () => {
    expect(presetNames()).toEqual(["aggressive", "casual", "conservative", "standard"]);
  });

  for (const name of ["standard", "conservative", "aggressive", "casual"]) {
    it(`preview wins for ${name}`, () => {
      const config = scoringPreset(name);
      const awarded = scoringEngine.preview(config, "win", 1, false);
      expect(awarded).toBe(config.winPoints);
    });
  }

  it("falls back to standard for unknown presets", () => {
    expect(scoringPreset("missing").winPoints).toBe(DEFAULT_SCORING.winPoints);
  });

  it("computes penalty helpers", () => {
    expect(lateSubmissionPenalty(12).amount).toBe(10);
    expect(unsportsmanlikePenalty(2).amount).toBe(50);
    expect(manualPenalty(-15, "note").amount).toBe(15);
  });

  it("sums bonuses", () => {
    const combined = sumBonuses([winStreakBonus(5, DEFAULT_SCORING), perfectGameBonus(120)]);
    expect(combined.amount).toBeGreaterThan(0);
  });
});

describe("tournament helpers", () => {
  it("tracks remaining slots", () => {
    const tournament = createTournament({
      id: "tnm_x",
      name: "Extra",
      format: "round_robin",
      createdAt: T0,
      capacity: 2,
    });
    expect(remainingSlots(tournament)).toBe(2);
    expect(isFull(tournament)).toBe(false);
    expect(createPlayer({ id: "plr_z", displayName: "Zed", createdAt: T0 }).id).toBe("plr_z");
  });

  it("labels rank movement", () => {
    expect(movementLabel({
      playerId: "plr_a",
      tournamentId: "tnm",
      rank: 1,
      score: 1,
      tieBreakScore: 0,
      previousRank: undefined,
      movement: 0,
      explanation: explain("x", "x"),
    })).toBe("new");
    expect(movementLabel({
      playerId: "plr_a",
      tournamentId: "tnm",
      rank: 2,
      score: 1,
      tieBreakScore: 0,
      previousRank: 2,
      movement: 0,
      explanation: explain("x", "x"),
    })).toBe("unchanged");
    expect(movementLabel({
      playerId: "plr_a",
      tournamentId: "tnm",
      rank: 3,
      score: 1,
      tieBreakScore: 0,
      previousRank: 1,
      movement: -2,
      explanation: explain("x", "x"),
    })).toBe("down 2");
  });
});
