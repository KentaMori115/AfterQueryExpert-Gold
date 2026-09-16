import { describe, expect, it } from "vitest";
import { createPlayer } from "../../src/domain/players/index.js";
import {
  expectedScore,
  matchmakingEngine,
  nextRating,
  skillSpread,
} from "../../src/engine/matchmaking/index.js";

const T0 = 1_700_001_300_000;

describe("matchmaking engine", () => {
  it("pairs closest skill ratings and drafts balanced teams", () => {
    const players = [
      createPlayer({ id: "plr_a", displayName: "A", createdAt: T0, skillRating: 1000 }),
      createPlayer({ id: "plr_b", displayName: "B", createdAt: T0, skillRating: 1010 }),
      createPlayer({ id: "plr_c", displayName: "C", createdAt: T0, skillRating: 1600 }),
      createPlayer({ id: "plr_d", displayName: "D", createdAt: T0, skillRating: 1590 }),
    ];
    const pairs = matchmakingEngine.proposePairs(players);
    expect(pairs).toHaveLength(2);
    expect(pairs.some((pair) => pair.playerIds.includes("plr_a") && pair.playerIds.includes("plr_b"))).toBe(true);
    const teams = matchmakingEngine.proposeTeams(players, 2);
    expect(teams).toHaveLength(2);
    expect(skillSpread(teams)).toBeLessThan(50);
  });

  it("uses a deterministic rating update", () => {
    const a = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0, skillRating: 1000 });
    const b = createPlayer({ id: "plr_b", displayName: "B", createdAt: T0, skillRating: 1000 });
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(nextRating(a, b, 1)).toBeCloseTo(1016);
  });
});
