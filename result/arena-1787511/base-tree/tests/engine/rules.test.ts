import { describe, expect, it } from "vitest";
import { IneligibleError } from "../../src/errors.js";
import { createPlayer } from "../../src/domain/players/index.js";
import { createTournament } from "../../src/domain/tournaments/index.js";
import { ruleEngine, tagMultiplier, vipScoreModifier } from "../../src/engine/rules/index.js";

const T0 = 1_700_001_200_000;

describe("rule engine", () => {
  it("accepts eligible players and explains vip multipliers", () => {
    const player = createPlayer({ id: "plr_v", displayName: "Vip", createdAt: T0, vip: true, level: 5 });
    const tournament = createTournament({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
      rules: { minLevel: 3 },
    });
    const decision = ruleEngine.evaluate({ player, tournament });
    expect(decision.eligible).toBe(true);
    expect(ruleEngine.modifiers(player, tournament).multiplier).toBeCloseTo(1.1);
    expect(vipScoreModifier(player, tournament.scoring).multiplier).toBeCloseTo(1.1);
    expect(tagMultiplier(player, "pro", 1.2).multiplier).toBe(1);
  });

  it("rejects banned tags, low levels, and vip-only events", () => {
    const banned = createPlayer({
      id: "plr_x",
      displayName: "Xray",
      createdAt: T0,
      level: 1,
      tags: ["smurf"],
    });
    const tournament = createTournament({
      id: "tnm_vip",
      name: "Vip Only",
      format: "leaderboard",
      createdAt: T0,
      rules: { minLevel: 10, requireVip: true, bannedTags: ["smurf"] },
    });
    const decision = ruleEngine.evaluate({ player: banned, tournament });
    expect(decision.eligible).toBe(false);
    expect(() => ruleEngine.assertEligible(banned, tournament)).toThrow(IneligibleError);
  });
});
