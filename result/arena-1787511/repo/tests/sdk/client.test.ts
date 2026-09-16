import { describe, expect, it } from "vitest";
import { ArenaFlowRequestError, ArenaFlowSdk } from "../../src/sdk/index.js";

const T0 = 1_700_002_000_000;

describe("sdk client", () => {
  it("creates players and tournaments in memory", async () => {
    const sdk = ArenaFlowSdk.inMemory();
    const player = await sdk.players.create({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    expect(player.id).toBe("plr_a");
    const tournament = await sdk.tournaments.create({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
    });
    expect(tournament.name).toBe("Cup");
    await sdk.tournaments.open("tnm_cup", T0 + 1);
    await sdk.players.create({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    await sdk.tournaments.register("tnm_cup", "plr_a", T0 + 2);
    await sdk.tournaments.register("tnm_cup", "plr_b", T0 + 3);
    await sdk.tournaments.start("tnm_cup", T0 + 4);
    await sdk.matches.create({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0 + 5,
    });
    await sdk.matches.start("mch_1", T0 + 6);
    await sdk.matches.submitResult("mch_1", { winnerId: "plr_a", loserId: "plr_b", at: T0 + 7 });
    const board = await sdk.rankings.leaderboard("tnm_cup");
    expect(board.entries[0]?.playerId).toBe("plr_a");
    await sdk.tournaments.end("tnm_cup", T0 + 8);
    await expect(sdk.tournaments.get("missing")).rejects.toBeInstanceOf(ArenaFlowRequestError);
  });
});
