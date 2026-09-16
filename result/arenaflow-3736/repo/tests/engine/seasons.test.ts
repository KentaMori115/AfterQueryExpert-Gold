import { describe, expect, it } from "vitest";
import { createPlayer } from "../../src/domain/players/index.js";
import { seasonManager } from "../../src/engine/seasons/index.js";

const T0 = 1_700_001_600_000;

describe("season manager", () => {
  it("opens, closes, and resets ranks", () => {
    const season = seasonManager.open(
      {
        id: "ssn_1",
        name: "Season 1",
        createdAt: T0,
        startsAt: T0,
        endsAt: T0 + 10_000,
        resetRanksOnClose: true,
      },
      T0,
    );
    expect(season.status).toBe("active");
    const archive = seasonManager.close(season, T0 + 10_000, [
      {
        playerId: "plr_a",
        tournamentId: "tnm_cup",
        rank: 1,
        score: 100,
        tieBreakScore: 0,
        previousRank: undefined,
        movement: 0,
        explanation: { code: "x", message: "x", details: {} },
      },
    ]);
    expect(archive.season.status).toBe("closed");
    expect(archive.rankings).toEqual([]);
    const player = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    expect(seasonManager.progressPlayer(player, 3000).step.title).toBe("Elite");
    expect(seasonManager.resetScores("tnm_cup", ["plr_a"], T0)[0]?.total).toBe(0);
  });
});
