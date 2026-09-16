import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import {
  expectedRoundRobinMatches,
  nextPowerOfTwo,
  roundRobinSchedule,
  seededBracket,
  teamStandings,
  assignTeams,
  timeChallengeScore,
} from "../../src/engine/tournament/formats/index.js";
import { createPlayer } from "../../src/domain/players/index.js";

const T0 = 1_700_001_700_000;

function seededService() {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_a", displayName: "Alpha", createdAt: T0 });
  service.createPlayer({ id: "plr_b", displayName: "Bravo", createdAt: T0, vip: true });
  service.createTournament({
    id: "tnm_cup",
    name: "Cup",
    format: "leaderboard",
    createdAt: T0,
    rewards: {
      prizePool: 100,
      claimWindowMs: undefined,
      tiers: [{ name: "gold", minRank: 1, maxRank: 1, amount: 100, shareOfPool: undefined }],
    },
  });
  service.openRegistration("tnm_cup", T0 + 1);
  service.register("tnm_cup", "plr_a", T0 + 2);
  service.register("tnm_cup", "plr_b", T0 + 3);
  service.start("tnm_cup", T0 + 4);
  return service;
}

describe("tournament service lifecycle", () => {
  it("registers players, records a match, ranks, and pays the winner", () => {
    const service = seededService();
    service.createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0 + 5,
    });
    service.startMatch("mch_1", T0 + 6);
    service.submitPairResult({
      matchId: "mch_1",
      winnerId: "plr_b",
      loserId: "plr_a",
      at: T0 + 7,
    });
    const board = service.leaderboard("tnm_cup");
    expect(board.entries[0]?.playerId).toBe("plr_b");
    expect(board.entries[0]?.score).toBeCloseTo(110);
    service.end("tnm_cup", T0 + 8);
    const rewards = service.distributeRewards("tnm_cup", T0 + 9);
    expect(rewards[0]?.playerId).toBe("plr_b");
    expect(service.profile("plr_b").profile.wins).toBe(1);
    expect(service.rankingsFor("plr_b")[0]?.rank).toBe(1);
  });
});

describe("tournament formats", () => {
  it("builds elimination, round robin, team, and time-challenge artifacts", () => {
    const bracket = seededBracket(["plr_a", "plr_b", "plr_c"]);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(bracket).toHaveLength(2);
    const rr = roundRobinSchedule(["plr_a", "plr_b", "plr_c"]);
    expect(rr).toHaveLength(expectedRoundRobinMatches(3));
    const players = [
      createPlayer({ id: "plr_a", displayName: "A", createdAt: T0, skillRating: 1400 }),
      createPlayer({ id: "plr_b", displayName: "B", createdAt: T0, skillRating: 1000 }),
      createPlayer({ id: "plr_c", displayName: "C", createdAt: T0, skillRating: 1390 }),
      createPlayer({ id: "plr_d", displayName: "D", createdAt: T0, skillRating: 1010 }),
    ];
    const teams = assignTeams(players, 2);
    const standings = teamStandings(teams, new Map([["plr_a", 10], ["plr_c", 8]]));
    expect(standings[0]?.score).toBeGreaterThan(0);
    expect(timeChallengeScore(100, 0, 1000)).toBe(200);
  });
});
