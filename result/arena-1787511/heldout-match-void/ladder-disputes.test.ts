import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { scoreKey } from "../../src/events/replay/state.js";
import { isArenaFlowError } from "../../src/errors.js";
import type { ArenaFlowErrorCode } from "../../src/errors.js";

const T0 = 1_700_100_000_000;

function cup(): { store: MemoryPersistence; service: TournamentService } {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
  service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0 });
  service.createPlayer({ id: "plr_cleo", displayName: "Cleo", createdAt: T0 });
  service.createPlayer({ id: "plr_dax", displayName: "Dax", createdAt: T0, vip: true });
  service.createTournament({
    id: "tnm_ladder",
    name: "Ladder",
    format: "leaderboard",
    createdAt: T0,
    rewards: {
      prizePool: 100,
      claimWindowMs: undefined,
      tiers: [{ name: "gold", minRank: 1, maxRank: 1, amount: 100, shareOfPool: undefined }],
    },
  });
  service.openRegistration("tnm_ladder", T0 + 1);
  service.register("tnm_ladder", "plr_ann", T0 + 2);
  service.register("tnm_ladder", "plr_ben", T0 + 3);
  service.register("tnm_ladder", "plr_cleo", T0 + 4);
  service.register("tnm_ladder", "plr_dax", T0 + 5);
  service.start("tnm_ladder", T0 + 6);
  return { store, service };
}

function play(
  service: TournamentService,
  matchId: string,
  winnerId: string,
  loserId: string,
  at: number,
): void {
  service.createMatch({
    id: matchId,
    tournamentId: "tnm_ladder",
    playerIds: [winnerId, loserId],
    createdAt: at,
  });
  service.startMatch(matchId, at + 1);
  service.submitPairResult({ matchId, winnerId, loserId, at: at + 2 });
}

function scoreOf(store: MemoryPersistence, playerId: string) {
  const record = store.listScores("tnm_ladder").find((score) => score.playerId === playerId);
  if (!record) {
    throw new Error(`no score record for ${playerId}`);
  }
  return record;
}

function failureCode(action: () => unknown): ArenaFlowErrorCode | "no-failure" {
  try {
    action();
    return "no-failure";
  } catch (error) {
    if (isArenaFlowError(error)) {
      return error.code;
    }
    throw error;
  }
}

/** Ann wins five in a row over Ben, so the fifth win carries a streak bonus. */
function fiveInARow(): { store: MemoryPersistence; service: TournamentService } {
  const arena = cup();
  for (let round = 1; round <= 5; round += 1) {
    play(arena.service, `mch_0${round}`, "plr_ann", "plr_ben", T0 + 100 * round);
  }
  return arena;
}

describe("withdrawn results", () => {
  it("takes the match out of play and keeps what it recorded", () => {
    const { store, service } = fiveInARow();
    const voided = service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    expect(voided.status).toBe("voided");
    expect(voided.completedAt).toBe(T0 + 900);
    expect(voided.results).toHaveLength(2);
    expect(store.getMatch("mch_03")?.status).toBe("voided");
  });

  it("pays back the points the withdrawn win carried", () => {
    const { store, service } = fiveInARow();
    expect(scoreOf(store, "plr_ann").total).toBe(550);
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    expect(scoreOf(store, "plr_ann").total).toBe(400);
  });

  it("stops paying a bonus the surviving wins no longer reach", () => {
    const { store, service } = fiveInARow();
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    const ann = scoreOf(store, "plr_ann");
    expect(ann.wins).toBe(4);
    expect(ann.streak).toBe(4);
    expect(ann.bestStreak).toBe(4);
  });

  it("rebuilds the other side of the match as well", () => {
    const { store, service } = fiveInARow();
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    const ben = scoreOf(store, "plr_ben");
    expect(ben.total).toBe(-80);
    expect(ben.losses).toBe(4);
    expect(ben.wins).toBe(0);
  });

  it("leaves one reason on the record for each surviving result", () => {
    const { store, service } = fiveInARow();
    expect(scoreOf(store, "plr_ann").explanations).toHaveLength(5);
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    expect(scoreOf(store, "plr_ann").explanations).toHaveLength(4);
  });

  it("dates the record from the last result that still counts", () => {
    const { store, service } = fiveInARow();
    service.voidMatch({ matchId: "mch_05", at: T0 + 900, reason: "server fault" });
    expect(scoreOf(store, "plr_ann").lastUpdatedAt).toBe(T0 + 402);
  });

  it("hands back an empty record dated at the void when nothing survives", () => {
    const { store, service } = cup();
    play(service, "mch_only", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_only", at: T0 + 777, reason: "match never happened" });
    const ann = scoreOf(store, "plr_ann");
    expect(ann.total).toBe(0);
    expect(ann.wins).toBe(0);
    expect(ann.streak).toBe(0);
    expect(ann.bestStreak).toBe(0);
    expect(ann.explanations).toHaveLength(0);
    expect(ann.lastUpdatedAt).toBe(T0 + 777);
  });

  it("decides a vip award again at the same multiplier", () => {
    const { store, service } = cup();
    for (let round = 1; round <= 5; round += 1) {
      play(service, `mch_v${round}`, "plr_dax", "plr_cleo", T0 + 100 * round);
    }
    expect(scoreOf(store, "plr_dax").total).toBeCloseTo(605, 6);
    service.voidMatch({ matchId: "mch_v2", at: T0 + 900, reason: "server fault" });
    expect(scoreOf(store, "plr_dax").total).toBeCloseTo(440, 6);
    expect(scoreOf(store, "plr_dax").bestStreak).toBe(4);
  });

  it("keeps counting the results that came after the withdrawn one", () => {
    const { store, service } = cup();
    play(service, "mch_a1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_a2", "plr_ben", "plr_ann", T0 + 200);
    play(service, "mch_a3", "plr_ann", "plr_ben", T0 + 300);
    service.voidMatch({ matchId: "mch_a1", at: T0 + 900, reason: "wrong bracket" });
    const ann = scoreOf(store, "plr_ann");
    expect(ann.total).toBe(80);
    expect(ann.wins).toBe(1);
    expect(ann.losses).toBe(1);
    expect(ann.streak).toBe(1);
    expect(ann.bestStreak).toBe(1);
  });

  it("folds results that finished together in match id order", () => {
    const { store, service } = cup();
    for (let round = 1; round <= 4; round += 1) {
      play(service, `mch_r${round}`, "plr_ann", "plr_ben", T0 + 100 * round);
    }
    service.createMatch({
      id: "mch_ra",
      tournamentId: "tnm_ladder",
      playerIds: ["plr_cleo", "plr_ann"],
      createdAt: T0 + 500,
    });
    service.startMatch("mch_ra", T0 + 501);
    service.createMatch({
      id: "mch_rz",
      tournamentId: "tnm_ladder",
      playerIds: ["plr_ann", "plr_dax"],
      createdAt: T0 + 500,
    });
    service.startMatch("mch_rz", T0 + 501);
    service.submitPairResult({ matchId: "mch_rz", winnerId: "plr_ann", loserId: "plr_dax", at: T0 + 600 });
    service.submitPairResult({ matchId: "mch_ra", winnerId: "plr_cleo", loserId: "plr_ann", at: T0 + 600 });
    play(service, "mch_r9", "plr_dax", "plr_cleo", T0 + 700);
    service.voidMatch({ matchId: "mch_r9", at: T0 + 900, reason: "wrong bracket" });
    const ann = scoreOf(store, "plr_ann");
    expect(ann.total).toBe(480);
    expect(ann.bestStreak).toBe(4);
    expect(ann.streak).toBe(1);
  });

  it("leaves a player the withdrawal never reached exactly where they were", () => {
    const { store, service } = cup();
    play(service, "mch_b1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_b2", "plr_cleo", "plr_dax", T0 + 200);
    const before = scoreOf(store, "plr_cleo");
    service.voidMatch({ matchId: "mch_b1", at: T0 + 900, reason: "server fault" });
    const after = scoreOf(store, "plr_cleo");
    expect(after.total).toBe(before.total);
    expect(after.wins).toBe(before.wins);
    expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt);
  });

  it("changes no standing when the match never scored", () => {
    const { store, service } = cup();
    play(service, "mch_c1", "plr_ann", "plr_ben", T0 + 100);
    service.createMatch({
      id: "mch_c2",
      tournamentId: "tnm_ladder",
      playerIds: ["plr_ann", "plr_cleo"],
      createdAt: T0 + 200,
    });
    service.startMatch("mch_c2", T0 + 201);
    const voided = service.voidMatch({ matchId: "mch_c2", at: T0 + 900, reason: "player withdrew" });
    expect(voided.status).toBe("voided");
    expect(scoreOf(store, "plr_ann").total).toBe(100);
  });

  it("refuses a further result on a match that left play", () => {
    const { service } = cup();
    play(service, "mch_d1", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_d1", at: T0 + 900, reason: "server fault" });
    expect(
      failureCode(() =>
        service.submitPairResult({
          matchId: "mch_d1",
          winnerId: "plr_ann",
          loserId: "plr_ben",
          at: T0 + 950,
        }),
      ),
    ).toBe("ANTI_CHEAT");
  });

  it("replays the journal onto the same standings", () => {
    const { store, service } = fiveInARow();
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    const live = scoreOf(store, "plr_ann");
    const replayed = store.load().scores.get(scoreKey("tnm_ladder", "plr_ann"));
    expect(replayed?.total).toBe(live.total);
    expect(replayed?.wins).toBe(live.wins);
    expect(replayed?.bestStreak).toBe(live.bestStreak);
    expect(replayed?.lastUpdatedAt).toBe(live.lastUpdatedAt);
  });

  it("records the withdrawal on the match's own stream", () => {
    const { store, service } = cup();
    play(service, "mch_e1", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_e1", at: T0 + 900, reason: "opponent disconnected" });
    const events = store.journal.readStream("match:mch_e1").filter((event) => event.type === "MatchVoided");
    expect(events).toHaveLength(1);
    expect(events[0]?.at).toBe(T0 + 900);
    expect(events[0]?.payload).toMatchObject({
      matchId: "mch_e1",
      tournamentId: "tnm_ladder",
      reason: "opponent disconnected",
    });
  });
});

describe("withdrawal ledger", () => {
  it("keeps one entry for each withdrawal, oldest first", () => {
    const { service } = cup();
    play(service, "mch_f1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_f2", "plr_cleo", "plr_dax", T0 + 200);
    service.voidMatch({ matchId: "mch_f1", at: T0 + 800, reason: "server fault" });
    service.voidMatch({ matchId: "mch_f2", at: T0 + 900, reason: "wrong bracket" });
    const history = service.voidHistory("tnm_ladder");
    expect(history.map((entry) => entry.matchId)).toEqual(["mch_f1", "mch_f2"]);
    expect(history.map((entry) => entry.at)).toEqual([T0 + 800, T0 + 900]);
    expect(history[1]?.reason).toBe("wrong bracket");
    expect(history[0]?.previousStatus).toBe("completed");
    expect(history[0]?.tournamentId).toBe("tnm_ladder");
  });

  it("lists only the players whose total moved, with the points either side", () => {
    const { service } = fiveInARow();
    play(service, "mch_g9", "plr_cleo", "plr_dax", T0 + 600);
    service.voidMatch({ matchId: "mch_03", at: T0 + 900, reason: "server fault" });
    const entry = service.voidHistory("tnm_ladder")[0];
    expect(entry?.changes.map((change) => change.playerId)).toEqual(["plr_ann", "plr_ben"]);
    expect(entry?.changes[0]).toMatchObject({ before: 550, after: 400, delta: -150 });
    expect(entry?.changes[1]).toMatchObject({ before: -100, after: -80, delta: 20 });
  });

  it("holds nothing before a result is withdrawn", () => {
    const { service } = cup();
    play(service, "mch_g1", "plr_ann", "plr_ben", T0 + 100);
    expect(service.voidHistory("tnm_ladder")).toHaveLength(0);
    expect(service.voidsForPlayer("plr_ann")).toHaveLength(0);
  });

  it("keeps an entry for a withdrawal that moved no total", () => {
    const { service } = cup();
    service.createMatch({
      id: "mch_g2",
      tournamentId: "tnm_ladder",
      playerIds: ["plr_ann", "plr_ben"],
      createdAt: T0 + 100,
    });
    service.startMatch("mch_g2", T0 + 101);
    service.voidMatch({ matchId: "mch_g2", at: T0 + 900, reason: "player withdrew" });
    const entry = service.voidHistory("tnm_ladder")[0];
    expect(entry?.previousStatus).toBe("started");
    expect(entry?.changes).toHaveLength(0);
  });

  it("answers for one player across the withdrawals that touched them", () => {
    const { service } = cup();
    play(service, "mch_h1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_h2", "plr_cleo", "plr_dax", T0 + 200);
    service.voidMatch({ matchId: "mch_h1", at: T0 + 800, reason: "server fault" });
    service.voidMatch({ matchId: "mch_h2", at: T0 + 900, reason: "server fault" });
    expect(service.voidsForPlayer("plr_ann").map((entry) => entry.matchId)).toEqual(["mch_h1"]);
    expect(service.voidsForPlayer("plr_dax").map((entry) => entry.matchId)).toEqual(["mch_h2"]);
  });

  it("needs a reason", () => {
    const { service } = cup();
    play(service, "mch_i1", "plr_ann", "plr_ben", T0 + 100);
    expect(failureCode(() => service.voidMatch({ matchId: "mch_i1", at: T0 + 900, reason: "  " }))).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("refuses once the tournament is over", () => {
    const { service } = cup();
    play(service, "mch_j1", "plr_ann", "plr_ben", T0 + 100);
    service.end("tnm_ladder", T0 + 500);
    expect(
      failureCode(() => service.voidMatch({ matchId: "mch_j1", at: T0 + 900, reason: "server fault" })),
    ).toBe("ILLEGAL_STATE");
  });

  it("refuses the same match twice", () => {
    const { service } = cup();
    play(service, "mch_k1", "plr_ann", "plr_ben", T0 + 100);
    service.voidMatch({ matchId: "mch_k1", at: T0 + 900, reason: "server fault" });
    expect(
      failureCode(() => service.voidMatch({ matchId: "mch_k1", at: T0 + 950, reason: "server fault" })),
    ).toBe("CONFLICT");
  });

  it("refuses a match nobody created", () => {
    const { service } = cup();
    expect(
      failureCode(() => service.voidMatch({ matchId: "mch_ghost", at: T0 + 900, reason: "server fault" })),
    ).toBe("NOT_FOUND");
  });
});

describe("published standings", () => {
  it("leaves every rank new until a board is published", () => {
    const { service } = cup();
    play(service, "mch_l1", "plr_ann", "plr_ben", T0 + 100);
    const board = service.leaderboard("tnm_ladder");
    expect(board.entries[0]?.previousRank).toBeUndefined();
    expect(board.entries.every((entry) => entry.movement === 0)).toBe(true);
  });

  it("measures movement against the board an operator stood behind", () => {
    const { service } = cup();
    play(service, "mch_m1", "plr_ann", "plr_ben", T0 + 100);
    const published = service.publishLeaderboard("tnm_ladder", T0 + 200);
    expect(published.at).toBe(T0 + 200);
    expect(published.tournamentId).toBe("tnm_ladder");
    expect(published.board.entries.map((entry) => entry.playerId)).toEqual(["plr_ann", "plr_ben"]);
    service.voidMatch({ matchId: "mch_m1", at: T0 + 300, reason: "server fault" });
    play(service, "mch_m2", "plr_ben", "plr_ann", T0 + 400);
    const board = service.leaderboard("tnm_ladder");
    expect(board.entries[0]?.playerId).toBe("plr_ben");
    expect(board.entries[0]?.previousRank).toBe(2);
    expect(board.entries[0]?.movement).toBe(1);
    expect(board.entries[1]?.movement).toBe(-1);
  });

  it("moves the baseline on every publication", () => {
    const { service } = cup();
    play(service, "mch_n1", "plr_ann", "plr_ben", T0 + 100);
    service.publishLeaderboard("tnm_ladder", T0 + 200);
    play(service, "mch_n2", "plr_ben", "plr_ann", T0 + 300);
    play(service, "mch_n3", "plr_ben", "plr_ann", T0 + 400);
    service.publishLeaderboard("tnm_ladder", T0 + 500);
    expect(service.leaderboard("tnm_ladder").entries[0]?.movement).toBe(0);
  });

  it("hands back the last published board", () => {
    const { service } = cup();
    play(service, "mch_o1", "plr_ann", "plr_ben", T0 + 100);
    service.publishLeaderboard("tnm_ladder", T0 + 200);
    service.publishLeaderboard("tnm_ladder", T0 + 300);
    expect(service.publishedLeaderboard("tnm_ladder").at).toBe(T0 + 300);
  });

  it("has nothing to hand back before the first publication", () => {
    const { service } = cup();
    expect(failureCode(() => service.publishedLeaderboard("tnm_ladder"))).toBe("NOT_FOUND");
  });

  it("keeps every publication, oldest first", () => {
    const { service } = cup();
    play(service, "mch_p1", "plr_ann", "plr_ben", T0 + 100);
    service.publishLeaderboard("tnm_ladder", T0 + 200);
    service.publishLeaderboard("tnm_ladder", T0 + 300);
    expect(service.publicationHistory("tnm_ladder").map((entry) => entry.at)).toEqual([
      T0 + 200,
      T0 + 300,
    ]);
  });

  it("moves a single player's ranking against the published board too", () => {
    const { service } = cup();
    play(service, "mch_t1", "plr_ann", "plr_ben", T0 + 100);
    service.publishLeaderboard("tnm_ladder", T0 + 200);
    service.voidMatch({ matchId: "mch_t1", at: T0 + 300, reason: "server fault" });
    play(service, "mch_t2", "plr_ben", "plr_ann", T0 + 400);
    expect(service.rankingsFor("plr_ben")[0]?.movement).toBe(1);
  });

  it("pays the tournament out on the rebuilt standings", () => {
    const { service } = cup();
    play(service, "mch_u1", "plr_ann", "plr_ben", T0 + 100);
    play(service, "mch_u2", "plr_ben", "plr_ann", T0 + 200);
    play(service, "mch_u3", "plr_ben", "plr_ann", T0 + 300);
    service.voidMatch({ matchId: "mch_u2", at: T0 + 400, reason: "server fault" });
    service.voidMatch({ matchId: "mch_u3", at: T0 + 401, reason: "server fault" });
    service.end("tnm_ladder", T0 + 500);
    const rewards = service.distributeRewards("tnm_ladder", T0 + 600);
    expect(rewards.map((reward) => reward.playerId)).toEqual(["plr_ann"]);
    expect(service.profile("plr_ann").profile.wins).toBe(1);
  });
});
