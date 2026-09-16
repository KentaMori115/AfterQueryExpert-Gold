import { describe, expect, it } from "vitest";
import {
  ALL_RECIPES,
  RECIPE_VIP_INVITATIONAL,
  recipeByName,
  recipesFor,
  totalPrizePools,
} from "../../src/examples/recipes.js";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { buildTournamentReport, renderReport } from "../../src/engine/reporting/index.js";

const T0 = 1_700_002_600_000;

describe("tournament recipes", () => {
  it("exposes a named catalog", () => {
    expect(ALL_RECIPES.length).toBeGreaterThanOrEqual(10);
    expect(recipeByName("VIP Invitational")).toEqual(RECIPE_VIP_INVITATIONAL);
    expect(recipesFor("leaderboard").length).toBeGreaterThan(0);
    expect(totalPrizePools()).toBeGreaterThan(0);
  });

  for (const recipe of ALL_RECIPES) {
    it(`can create ${recipe.name}`, () => {
      const service = new TournamentService(new MemoryPersistence());
      const tournament = service.createTournament({
        id: `tnm_${recipe.format}_${recipe.capacity}`,
        name: recipe.name,
        format: recipe.format,
        createdAt: T0,
        capacity: recipe.capacity,
        scoring: recipe.scoring,
        rules: recipe.rules,
        rewards: recipe.rewards,
      });
      expect(tournament.format).toBe(recipe.format);
      expect(tournament.capacity).toBe(recipe.capacity);
    });
  }
});

describe("reports", () => {
  it("renders standings narrative", () => {
    const service = new TournamentService(new MemoryPersistence());
    service.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_a", T0 + 2);
    service.register("tnm_cup", "plr_b", T0 + 3);
    service.start("tnm_cup", T0 + 4);
    service.createMatch({ id: "mch_1", tournamentId: "tnm_cup", playerIds: ["plr_a", "plr_b"], createdAt: T0 + 5 });
    service.startMatch("mch_1", T0 + 6);
    service.submitPairResult({ matchId: "mch_1", winnerId: "plr_a", loserId: "plr_b", at: T0 + 7 });
    const tournament = service.getTournament("tnm_cup");
    const report = buildTournamentReport(tournament, service.leaderboard("tnm_cup").entries, [], []);
    expect(renderReport(report)).toContain("Cup");
    expect(report.standings[0]?.playerId).toBe("plr_a");
  });
});
