import { describe, expect, it } from "vitest";
import { IllegalStateError } from "../../src/errors.js";
import { createPlayer } from "../../src/domain/players/index.js";
import {
  activateSeason,
  applySeasonLevel,
  closeSeason,
  createSeason,
  levelForScore,
  nextStep,
  seasonContains,
} from "../../src/domain/seasons/index.js";

const T0 = 1_700_000_600_000;

describe("season domain", () => {
  it("activates and closes a season", () => {
    const season = createSeason({
      id: "ssn_s1",
      name: "Season One",
      createdAt: T0,
      startsAt: T0 + 10,
      endsAt: T0 + 1000,
    });
    expect(season.status).toBe("upcoming");
    expect(() => activateSeason(season, T0 + 5)).toThrow(IllegalStateError);
    const active = activateSeason(season, T0 + 10);
    expect(active.status).toBe("active");
    expect(seasonContains(active, T0 + 50)).toBe(true);
    expect(closeSeason(active, T0 + 1000).status).toBe("closed");
  });

  it("maps score totals onto progression titles", () => {
    expect(levelForScore(0).title).toBe("Recruit");
    expect(levelForScore(1500).title).toBe("Veteran");
    expect(nextStep(1500)?.title).toBe("Elite");
    const player = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    expect(applySeasonLevel(player, 5000).level).toBe(6);
  });
});
