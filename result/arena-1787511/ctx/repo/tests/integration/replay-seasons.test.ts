import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { replayJournal } from "../../src/events/replay/replay.js";
import { seasonManager } from "../../src/engine/seasons/index.js";
import { createSeason } from "../../src/domain/seasons/index.js";

const T0 = 1_700_002_200_000;

describe("replay and season integration", () => {
  it("replays a completed tournament from the journal", () => {
    const store = new MemoryPersistence();
    const service = new TournamentService(store);
    service.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_a", T0 + 2);
    service.register("tnm_cup", "plr_b", T0 + 3);
    service.start("tnm_cup", T0 + 4);
    service.createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0 + 5,
    });
    service.startMatch("mch_1", T0 + 6);
    service.submitPairResult({ matchId: "mch_1", winnerId: "plr_a", loserId: "plr_b", at: T0 + 7 });
    service.end("tnm_cup", T0 + 8);
    const replayed = replayJournal(store.journal);
    expect(replayed.tournaments.get("tnm_cup")?.status).toBe("completed");
    expect(replayed.scores.get("tnm_cup::plr_a")?.wins).toBe(1);
  });

  it("closes a season and resets scores", () => {
    const season = seasonManager.open(
      {
        id: "ssn_2",
        name: "Season Two",
        createdAt: T0,
        startsAt: T0,
        endsAt: T0 + 5000,
      },
      T0,
    );
    const archive = seasonManager.close(season, T0 + 5000);
    expect(archive.season.status).toBe("closed");
    expect(seasonManager.resetScores("tnm_cup", ["plr_a", "plr_b"], T0 + 5001).every((score) => score.total === 0)).toBe(
      true,
    );
    const upcoming = createSeason({
      id: "ssn_3",
      name: "Season Three",
      createdAt: T0,
      startsAt: T0 + 10,
      endsAt: T0 + 20,
    });
    expect(upcoming.status).toBe("upcoming");
  });
});
