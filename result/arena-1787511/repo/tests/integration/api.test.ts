import { describe, expect, it } from "vitest";
import { createArena } from "../../src/api/server.js";

const T0 = 1_700_001_900_000;

describe("REST API", () => {
  it("walks a tournament from registration through rewards", async () => {
    const { router } = createArena();
    const health = await router.handle("GET", "/health");
    expect(health.status).toBe(200);

    expect((await router.handle("POST", "/players", { id: "plr_a", displayName: "Ann", createdAt: T0 })).status).toBe(201);
    expect((await router.handle("POST", "/players", { id: "plr_b", displayName: "Ben", createdAt: T0, vip: true })).status).toBe(201);
    const created = await router.handle("POST", "/tournaments", {
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
      rewards: {
        prizePool: 50,
        tiers: [{ name: "gold", minRank: 1, maxRank: 1, amount: 50 }],
      },
    });
    expect(created.status).toBe(201);

    await router.handle("POST", "/tournaments/tnm_cup/open", { at: T0 + 1 });
    await router.handle("POST", "/tournaments/tnm_cup/register", { playerId: "plr_a", at: T0 + 2 });
    await router.handle("POST", "/tournaments/tnm_cup/register", { playerId: "plr_b", at: T0 + 3 });
    await router.handle("POST", "/tournaments/tnm_cup/start", { at: T0 + 4 });
    await router.handle("POST", "/matches", {
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0 + 5,
    });
    await router.handle("POST", "/matches/mch_1/start", { at: T0 + 6 });
    const result = await router.handle("POST", "/matches/mch_1/result", {
      winnerId: "plr_a",
      loserId: "plr_b",
      at: T0 + 7,
    });
    expect(result.status).toBe(200);

    const board = await router.handle("GET", "/leaderboards/tnm_cup");
    expect(board.status).toBe(200);
    expect((board.body as { entries: Array<{ playerId: string }> }).entries[0]?.playerId).toBe("plr_a");

    await router.handle("POST", "/tournaments/tnm_cup/end", { at: T0 + 8 });
    const rewards = await router.handle("POST", "/rewards/distribute", { tournamentId: "tnm_cup", at: T0 + 9 });
    expect(rewards.status).toBe(200);

    const profile = await router.handle("GET", "/players/plr_a/profile");
    expect(profile.status).toBe(200);
    const listed = await router.handle("GET", "/rewards/plr_a");
    expect(listed.status).toBe(200);
  });
});
