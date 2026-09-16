import { describe, expect, it } from "vitest";
import { SqlitePersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";

const T0 = 1_700_001_800_000;

describe("sqlite persistence", () => {
  it("persists events, aggregates, and snapshots", () => {
    const store = new SqlitePersistence(":memory:");
    const service = new TournamentService(store);
    service.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_a", T0 + 2);
    service.register("tnm_cup", "plr_b", T0 + 3);
    expect(store.listPlayers()).toHaveLength(2);
    expect(store.journal.count()).toBeGreaterThan(3);
    const snapshot = store.checkpoint(T0 + 4);
    expect(snapshot.lastSequence).toBe(store.journal.lastSequence());
    const reloaded = store.load();
    expect(reloaded.tournaments.get("tnm_cup")?.registeredPlayerIds).toEqual(["plr_a", "plr_b"]);
    store.close();
  });
});
