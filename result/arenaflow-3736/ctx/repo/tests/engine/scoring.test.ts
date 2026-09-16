import { describe, expect, it } from "vitest";
import { createPlayer } from "../../src/domain/players/index.js";
import { createTournament } from "../../src/domain/tournaments/index.js";
import { emptyScore } from "../../src/domain/scores/index.js";
import {
  antiCheatPenalty,
  scoringEngine,
  vipMultiplierBonus,
  winStreakBonus,
} from "../../src/engine/scoring/index.js";
import { DEFAULT_SCORING } from "../../src/types.js";

const T0 = 1_700_001_000_000;

describe("scoring engine", () => {
  it("awards default win and loss points", () => {
    const player = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    const tournament = createTournament({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
    });
    const win = scoringEngine.decide({
      player,
      tournament,
      current: emptyScore(player.id, tournament.id, T0),
      outcome: "win",
      rawScore: 1,
      at: T0 + 1,
    });
    expect(win.awarded).toBe(100);
    expect(win.next.wins).toBe(1);
    const loss = scoringEngine.decide({
      player,
      tournament,
      current: win.next,
      outcome: "loss",
      rawScore: 0,
      at: T0 + 2,
    });
    expect(loss.awarded).toBe(-20);
    expect(loss.next.total).toBe(80);
    expect(loss.next.streak).toBe(0);
  });

  it("adds a 5-win streak bonus and vip multiplier", () => {
    const player = createPlayer({ id: "plr_v", displayName: "Vip", createdAt: T0, vip: true });
    const tournament = createTournament({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
    });
    let current = emptyScore(player.id, tournament.id, T0);
    for (let i = 0; i < 5; i += 1) {
      const decision = scoringEngine.decide({
        player,
        tournament,
        current,
        outcome: "win",
        rawScore: 1,
        at: T0 + i + 1,
      });
      current = decision.next;
    }
    expect(current.streak).toBe(5);
    expect(current.total).toBeCloseTo(110 * 4 + 165);
    expect(winStreakBonus(5, DEFAULT_SCORING).amount).toBe(50);
    expect(vipMultiplierBonus(150, true, DEFAULT_SCORING).amount).toBeCloseTo(15);
  });

  it("subtracts extra penalties and supports custom formulas", () => {
    const player = createPlayer({ id: "plr_c", displayName: "C", createdAt: T0 });
    const tournament = createTournament({
      id: "tnm_custom",
      name: "Custom",
      format: "leaderboard",
      createdAt: T0,
      scoring: { customFormula: "BASE + RAW" },
    });
    const decision = scoringEngine.decide(
      {
        player,
        tournament,
        current: undefined,
        outcome: "win",
        rawScore: 8,
        at: T0 + 1,
      },
      antiCheatPenalty(10).amount,
    );
    expect(decision.breakdown.custom).toBe(108);
    expect(decision.awarded).toBe(83);
  });
});
