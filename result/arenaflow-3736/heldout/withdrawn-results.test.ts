import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { IllegalStateError, InvalidArgumentError, NotFoundError } from "../../src/errors.js";
import type { ScoringConfig } from "../../src/types.js";

const T0 = 1_700_000_000_000;

interface Arena {
  readonly store: MemoryPersistence;
  readonly service: TournamentService;
}

function arena(scoring?: Partial<ScoringConfig>): Arena {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
  service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0, vip: true });
  service.createPlayer({ id: "plr_cal", displayName: "Cal", createdAt: T0 });
  service.createPlayer({ id: "plr_dot", displayName: "Dot", createdAt: T0 });
  service.createTournament({
    id: "tnm_cup",
    name: "Cup",
    format: "leaderboard",
    createdAt: T0,
    ...(scoring ? { scoring } : {}),
  });
  service.openRegistration("tnm_cup", T0 + 1);
  service.register("tnm_cup", "plr_ann", T0 + 2);
  service.register("tnm_cup", "plr_ben", T0 + 3);
  service.register("tnm_cup", "plr_cal", T0 + 4);
  service.register("tnm_cup", "plr_dot", T0 + 5);
  service.start("tnm_cup", T0 + 6);
  return { store, service };
}

function play(
  service: TournamentService,
  id: string,
  winner: string,
  loser: string,
  at: number,
  tournamentId = "tnm_cup",
): void {
  service.createMatch({ id, tournamentId, playerIds: [winner, loser], createdAt: at - 2 });
  service.startMatch(id, at - 1);
  service.submitPairResult({ matchId: id, winnerId: winner, loserId: loser, at });
}

function scoreOf(store: MemoryPersistence, playerId: string, tournamentId = "tnm_cup") {
  return store.listScores(tournamentId).find((score) => score.playerId === playerId);
}

describe("withdrawing a completed match", () => {
  it("marks the match voided at the withdrawal time", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    const withdrawal = service.voidMatch({
      matchId: "mch_1",
      reason: "opponent disconnected",
      at: T0 + 500,
    });
    expect(withdrawal.match.status).toBe("voided");
    expect(withdrawal.match.completedAt).toBe(T0 + 500);
    expect(store.getMatch("mch_1")?.status).toBe("voided");
  });

  it("keeps the results the match was completed with", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_1", reason: "opponent disconnected", at: T0 + 500 });
    const results = store.getMatch("mch_1")?.results ?? [];
    expect(results).toHaveLength(2);
    expect([...results].map((result) => result.playerId).sort()).toEqual(["plr_ann", "plr_ben"]);
  });

  it("answers with the match, the tournament, the reason and the moment", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    const withdrawal = service.voidMatch({
      matchId: "mch_1",
      reason: "  opponent disconnected  ",
      at: T0 + 500,
    });
    expect(withdrawal.match.id).toBe("mch_1");
    expect(withdrawal.tournamentId).toBe("tnm_cup");
    expect(withdrawal.reason).toBe("opponent disconnected");
    expect(withdrawal.at).toBe(T0 + 500);
  });

  it("answers with the rebuilt records in player id order", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_cal", "plr_ann", T0 + 100);
    const withdrawal = service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(withdrawal.rebuilt.map((score) => score.playerId)).toEqual(["plr_ann", "plr_cal"]);
    expect(withdrawal.rebuilt.every((score) => score.tournamentId === "tnm_cup")).toBe(true);
  });
});

describe("rebuilding what the match fed", () => {
  it("rebuilds the total from the matches that still stand", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
    expect(scoreOf(store, "plr_ann")?.total).toBe(180);
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ann")?.total).toBe(80);
  });

  it("rebuilds the win, loss and draw counts", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    const ann = scoreOf(store, "plr_ann");
    expect(ann?.wins).toBe(1);
    expect(ann?.losses).toBe(1);
    expect(ann?.draws).toBe(0);
  });

  it("brings the best streak back down", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
    expect(scoreOf(store, "plr_ann")?.bestStreak).toBe(2);
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    const ann = scoreOf(store, "plr_ann");
    expect(ann?.bestStreak).toBe(1);
    expect(ann?.streak).toBe(0);
  });

  it("stamps the rebuilt record with the last match that still counts", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ann")?.lastUpdatedAt).toBe(T0 + 300);
  });

  it("leaves one reason behind per result that still counts", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
    expect(scoreOf(store, "plr_ann")?.explanations).toHaveLength(3);
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ann")?.explanations).toHaveLength(2);
  });

  it("stops paying a streak bonus the withdrawn win earned", () => {
    const { store, service } = arena();
    for (let index = 0; index < 5; index += 1) {
      play(service, `mch_s${index}`, "plr_ann", "plr_cal", T0 + 100 + index * 100);
    }
    expect(scoreOf(store, "plr_ann")?.total).toBe(550);
    service.voidMatch({ matchId: "mch_s2", reason: "misreported", at: T0 + 900 });
    const ann = scoreOf(store, "plr_ann");
    expect(ann?.total).toBe(400);
    expect(ann?.bestStreak).toBe(4);
  });

  it("scores the rebuild through the tournament's own multiplier", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ben", "plr_ann", T0 + 100);
    play(service, "mch_2", "plr_ben", "plr_cal", T0 + 200);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ben")?.total).toBeCloseTo(110, 6);
  });

  it("scores the rebuild through a custom formula", () => {
    const { store, service } = arena({ customFormula: "BASE + STREAK * 5" });
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_dot", T0 + 200);
    play(service, "mch_3", "plr_ann", "plr_ben", T0 + 300);
    expect(scoreOf(store, "plr_ann")?.total).toBe(330);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ann")?.total).toBe(215);
  });

  it("walks two matches settled together by match id", () => {
    const { store, service } = arena();
    play(service, "mch_z", "plr_ann", "plr_dot", T0 + 100);
    service.createMatch({
      id: "mch_b",
      tournamentId: "tnm_cup",
      playerIds: ["plr_ben", "plr_ann"],
      createdAt: T0 + 190,
    });
    service.createMatch({
      id: "mch_a",
      tournamentId: "tnm_cup",
      playerIds: ["plr_ann", "plr_cal"],
      createdAt: T0 + 195,
    });
    service.startMatch("mch_b", T0 + 196);
    service.startMatch("mch_a", T0 + 197);
    service.submitPairResult({
      matchId: "mch_b",
      winnerId: "plr_ben",
      loserId: "plr_ann",
      at: T0 + 200,
    });
    service.submitPairResult({
      matchId: "mch_a",
      winnerId: "plr_ann",
      loserId: "plr_cal",
      at: T0 + 200,
    });
    service.voidMatch({ matchId: "mch_z", reason: "misreported", at: T0 + 500 });
    const ann = scoreOf(store, "plr_ann");
    expect(ann?.total).toBe(80);
    expect(ann?.streak).toBe(0);
    expect(ann?.bestStreak).toBe(1);
  });

  it("never lets a withdrawn match feed a later rebuild", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    play(service, "mch_3", "plr_ann", "plr_dot", T0 + 300);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    service.voidMatch({ matchId: "mch_2", reason: "misreported again", at: T0 + 600 });
    const ann = scoreOf(store, "plr_ann");
    expect(ann?.total).toBe(100);
    expect(ann?.wins).toBe(1);
    expect(ann?.bestStreak).toBe(1);
    expect(ann?.lastUpdatedAt).toBe(T0 + 300);
  });

  it("rebuilds only from the tournament the match belongs to", () => {
    const { store, service } = arena();
    service.createTournament({ id: "tnm_open", name: "Open", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_open", T0 + 10);
    service.register("tnm_open", "plr_ann", T0 + 11);
    service.register("tnm_open", "plr_cal", T0 + 12);
    service.start("tnm_open", T0 + 13);
    play(service, "mch_open", "plr_ann", "plr_cal", T0 + 150, "tnm_open");
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_dot", T0 + 200);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_ann", "tnm_cup")?.total).toBe(100);
    expect(scoreOf(store, "plr_ann", "tnm_cup")?.wins).toBe(1);
    expect(scoreOf(store, "plr_ann", "tnm_open")?.total).toBe(100);
    expect(scoreOf(store, "plr_ann", "tnm_open")?.lastUpdatedAt).toBe(T0 + 150);
  });

  it("rebuilds a player's profile with it", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    expect(service.profile("plr_ann").profile.wins).toBe(2);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    const profile = service.profile("plr_ann").profile;
    expect(profile.wins).toBe(1);
    expect(profile.totalScore).toBe(100);
    expect(profile.bestStreak).toBe(1);
  });

  it("keeps the withdrawn match on the tournament and leaves the rest completed", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    const matches = store.listMatches("tnm_cup");
    expect(matches).toHaveLength(2);
    expect(matches.find((match) => match.id === "mch_2")?.status).toBe("completed");
    expect(matches.find((match) => match.id === "mch_1")?.startedAt).toBe(T0 + 99);
  });

  it("reranks the board on the rebuilt totals", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_dot", T0 + 200);
    play(service, "mch_3", "plr_ben", "plr_cal", T0 + 300);
    expect(service.leaderboard("tnm_cup").entries[0]?.playerId).toBe("plr_ann");
    service.voidMatch({ matchId: "mch_2", reason: "misreported", at: T0 + 500 });
    const board = service.leaderboard("tnm_cup");
    expect(board.entries[0]?.playerId).toBe("plr_ben");
    expect(board.entries[0]?.score).toBeCloseTo(110, 6);
  });
});

describe("players the withdrawal reaches", () => {
  it("zeroes a player left with nothing", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_dot", T0 + 200);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    const cal = scoreOf(store, "plr_cal");
    expect(cal).toBeDefined();
    expect(cal?.total).toBe(0);
    expect(cal?.wins).toBe(0);
    expect(cal?.losses).toBe(0);
    expect(cal?.streak).toBe(0);
    expect(cal?.bestStreak).toBe(0);
    expect(cal?.explanations).toHaveLength(0);
  });

  it("stamps an emptied record with the withdrawal time", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(scoreOf(store, "plr_cal")?.lastUpdatedAt).toBe(T0 + 500);
  });

  it("keeps an emptied player on the board", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    const board = service.leaderboard("tnm_cup");
    expect(board.size).toBe(2);
    expect(board.entries.map((entry) => entry.score)).toEqual([0, 0]);
  });

  it("rebuilds nobody outside the withdrawn match", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_cal", "plr_dot", T0 + 200);
    const withdrawal = service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(withdrawal.rebuilt.map((score) => score.playerId)).toEqual(["plr_ann", "plr_ben"]);
  });

  it("leaves a player the match never touched exactly as it was", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_2", "plr_cal", "plr_dot", T0 + 200);
    const before = scoreOf(store, "plr_cal");
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    const after = scoreOf(store, "plr_cal");
    expect(after?.total).toBe(before?.total);
    expect(after?.lastUpdatedAt).toBe(T0 + 200);
    expect(after?.explanations).toHaveLength(1);
    expect(scoreOf(store, "plr_dot")?.lastUpdatedAt).toBe(T0 + 200);
  });
});

describe("what a withdrawal refuses", () => {
  it("refuses a match that was never completed", () => {
    const { service } = arena();
    service.createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_ann", "plr_ben"],
      createdAt: T0 + 100,
    });
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "too early", at: T0 + 500 })).toThrow(
      IllegalStateError,
    );
    service.startMatch("mch_1", T0 + 101);
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "too early", at: T0 + 500 })).toThrow(
      IllegalStateError,
    );
  });

  it("refuses a match that is already withdrawn", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_1", reason: "misreported", at: T0 + 500 });
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "again", at: T0 + 600 })).toThrow(
      IllegalStateError,
    );
  });

  it("refuses once the tournament is no longer active", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    service.end("tnm_cup", T0 + 400);
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "too late", at: T0 + 500 })).toThrow(
      IllegalStateError,
    );
  });

  it("refuses a blank reason", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "   ", at: T0 + 500 })).toThrow(
      InvalidArgumentError,
    );
    expect(store.getMatch("mch_1")?.status).toBe("completed");
    expect(scoreOf(store, "plr_ann")?.total).toBe(100);
  });

  it("writes nothing when it refuses", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    const before = store.journal.count();
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "", at: T0 + 500 })).toThrow(
      InvalidArgumentError,
    );
    expect(store.journal.count()).toBe(before);
    expect(store.journal.readStream("match:mch_1").some((event) => event.type === "MatchVoided")).toBe(
      false,
    );
  });

  it("refuses a match nobody recorded", () => {
    const { service } = arena();
    expect(() => service.voidMatch({ matchId: "mch_x", reason: "misreported", at: T0 + 500 })).toThrow(
      NotFoundError,
    );
  });
});
