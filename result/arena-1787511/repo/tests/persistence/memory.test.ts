import { describe, expect, it } from "vitest";
import { createPlayer } from "../../src/domain/players/index.js";
import { createTournament, openRegistration, registerPlayer } from "../../src/domain/tournaments/index.js";
import { emptyScore } from "../../src/domain/scores/index.js";
import { MemoryPersistence } from "../../src/persistence/index.js";

const T0 = 1_700_000_900_000;

describe("memory persistence", () => {
  it("stores aggregates and lists them deterministically", () => {
    const store = new MemoryPersistence();
    const alpha = createPlayer({ id: "plr_z", displayName: "Zed", createdAt: T0 });
    const bravo = createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    store.savePlayer(alpha);
    store.savePlayer(bravo);
    expect(store.listPlayers().map((player) => player.id)).toEqual(["plr_a", "plr_z"]);

    let tournament = createTournament({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
    });
    tournament = openRegistration(tournament, T0 + 1);
    tournament = registerPlayer(tournament, bravo);
    store.saveTournament(tournament);
    expect(store.requireTournament("tnm_cup").registeredPlayerIds).toEqual(["plr_a"]);

    store.saveScore(emptyScore("plr_a", "tnm_cup", T0 + 2));
    expect(store.listScores("tnm_cup")).toHaveLength(1);
    store.checkpoint(T0 + 3);
    expect(store.snapshots.latest()?.lastSequence).toBe(0);
    store.close();
  });

  it("reloads state from journal after replace", () => {
    const store = new MemoryPersistence();
    store.journal.append({
      type: "PlayerCreated",
      at: T0,
      streamId: "player:plr_a",
      payload: { playerId: "plr_a", displayName: "Ann", skillRating: 1000, level: 1, vip: false },
      explanation: { code: "p", message: "p", details: {} },
    });
    const loaded = store.load();
    expect(loaded.players.get("plr_a")?.displayName).toBe("Ann");
    expect(store.getPlayer("plr_a")?.displayName).toBe("Ann");
  });
});
