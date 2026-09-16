import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { replayJournal } from "../../src/events/replay/replay.js";
import { IllegalStateError, InvalidArgumentError } from "../../src/errors.js";
import { rescorePlayer, standingMatches } from "../../src/engine/corrections/index.js";
import { buildTournamentReport } from "../../src/engine/reporting/index.js";
import { createArena } from "../../src/api/server.js";
import { runCli } from "../../src/cli/index.js";

const T0 = 1_700_003_000_000;

function arena() {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
  service.createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
  service.createPlayer({ id: "plr_c", displayName: "Cal", createdAt: T0 });
  service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
  service.openRegistration("tnm_cup", T0 + 1);
  service.register("tnm_cup", "plr_a", T0 + 2);
  service.register("tnm_cup", "plr_b", T0 + 3);
  service.register("tnm_cup", "plr_c", T0 + 4);
  service.start("tnm_cup", T0 + 5);
  return { store, service };
}

function play(service: TournamentService, id: string, winner: string, loser: string, at: number) {
  service.createMatch({ id, tournamentId: "tnm_cup", playerIds: [winner, loser], createdAt: at - 2 });
  service.startMatch(id, at - 1);
  service.submitPairResult({ matchId: id, winnerId: winner, loserId: loser, at });
}

function scoreOf(store: MemoryPersistence, playerId: string) {
  return store.listScores("tnm_cup").find((score) => score.playerId === playerId);
}

describe("voiding a match", () => {
  it("marks the match voided and keeps its results", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    const withdrawal = service.voidMatch({ matchId: "mch_1", reason: "wrong winner", at: T0 + 20 });
    expect(withdrawal.match.status).toBe("voided");
    expect(withdrawal.match.completedAt).toBe(T0 + 20);
    expect(withdrawal.match.results).toHaveLength(2);
    expect(withdrawal.tournamentId).toBe("tnm_cup");
    expect(withdrawal.reason).toBe("wrong winner");
    expect(withdrawal.at).toBe(T0 + 20);
    expect(withdrawal.rebuilt.map((score) => score.playerId)).toEqual(["plr_a", "plr_b"]);
    expect(store.getMatch("mch_1")?.status).toBe("voided");
  });

  it("rebuilds totals, records and streaks from what is left", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_2", "plr_a", "plr_c", T0 + 20);
    play(service, "mch_3", "plr_b", "plr_a", T0 + 30);
    expect(scoreOf(store, "plr_a")?.total).toBe(180);
    expect(scoreOf(store, "plr_a")?.bestStreak).toBe(2);

    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 40 });
    const ann = scoreOf(store, "plr_a");
    expect(ann?.total).toBe(80);
    expect(ann?.wins).toBe(1);
    expect(ann?.losses).toBe(1);
    expect(ann?.bestStreak).toBe(1);
    expect(ann?.streak).toBe(0);
    expect(ann?.lastUpdatedAt).toBe(T0 + 30);
    expect(ann?.explanations).toHaveLength(2);
  });

  it("zeroes a player with nothing left and stamps the withdrawal", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_c", T0 + 10);
    service.voidMatch({ matchId: "mch_1", reason: "duplicate submission", at: T0 + 40 });
    const cal = scoreOf(store, "plr_c");
    expect(cal?.total).toBe(0);
    expect(cal?.losses).toBe(0);
    expect(cal?.lastUpdatedAt).toBe(T0 + 40);
    expect(cal?.explanations).toHaveLength(0);
  });

  it("leaves players the match never touched alone", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_2", "plr_c", "plr_b", T0 + 20);
    const before = scoreOf(store, "plr_c");
    service.voidMatch({ matchId: "mch_1", reason: "wrong winner", at: T0 + 30 });
    expect(scoreOf(store, "plr_c")).toEqual(before);
  });

  it("drops a streak bonus the withdrawn win paid for", () => {
    const { store, service } = arena();
    const streaky = new Array(5).fill(0).map((_, index) => `mch_s${index}`);
    streaky.forEach((id, index) => {
      play(service, id, "plr_a", "plr_b", T0 + 10 + index * 10);
    });
    expect(scoreOf(store, "plr_a")?.total).toBe(550);
    service.voidMatch({ matchId: "mch_s0", reason: "wrong winner", at: T0 + 100 });
    expect(scoreOf(store, "plr_a")?.total).toBe(400);
    expect(scoreOf(store, "plr_a")?.bestStreak).toBe(4);
  });

  it("refuses anything but a completed match on an active tournament", () => {
    const { service } = arena();
    service.createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0 + 6,
    });
    expect(() => service.voidMatch({ matchId: "mch_1", reason: "early", at: T0 + 7 })).toThrow(
      IllegalStateError,
    );
    play(service, "mch_2", "plr_a", "plr_b", T0 + 10);
    expect(() => service.voidMatch({ matchId: "mch_2", reason: "  ", at: T0 + 11 })).toThrow(
      InvalidArgumentError,
    );
    service.end("tnm_cup", T0 + 12);
    expect(() => service.voidMatch({ matchId: "mch_2", reason: "late", at: T0 + 13 })).toThrow(
      IllegalStateError,
    );
  });

  it("explains the withdrawal with a total before and after", () => {
    const { service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_2", "plr_a", "plr_c", T0 + 20);
    const withdrawal = service.voidMatch({ matchId: "mch_2", reason: "wrong winner", at: T0 + 30 });
    const movements = withdrawal.explanation.details.movements as Array<{
      playerId: string;
      before: number;
      after: number;
      delta: number;
    }>;
    expect(movements.map((movement) => movement.playerId)).toEqual(["plr_a", "plr_c"]);
    expect(movements[0]).toEqual({ playerId: "plr_a", before: 200, after: 100, delta: -100 });
    expect(movements[1]?.after).toBe(0);
  });

  it("replays to the same scores it left behind", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_2", "plr_b", "plr_c", T0 + 20);
    service.voidMatch({ matchId: "mch_1", reason: "wrong winner", at: T0 + 30 });
    const replayed = replayJournal(store.journal);
    for (const score of store.listScores("tnm_cup")) {
      const projected = replayed.scores.get(`tnm_cup::${score.playerId}`);
      expect(projected?.total).toBe(score.total);
      expect(projected?.wins).toBe(score.wins);
      expect(projected?.bestStreak).toBe(score.bestStreak);
      expect(projected?.lastUpdatedAt).toBe(score.lastUpdatedAt);
    }
    const events = store.journal.readStream("match:mch_1");
    expect(events.at(-1)?.type).toBe("MatchVoided");
  });
});

describe("rescoring helpers", () => {
  it("walks settled matches oldest first and skips voided ones", () => {
    const { store, service } = arena();
    play(service, "mch_2", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_1", "plr_a", "plr_c", T0 + 20);
    service.voidMatch({ matchId: "mch_2", reason: "wrong winner", at: T0 + 30 });
    const matches = store.listMatches("tnm_cup");
    expect(standingMatches(matches, "tnm_cup").map((match) => match.id)).toEqual(["mch_1"]);
    const ann = rescorePlayer(
      service.getTournament("tnm_cup"),
      service.getPlayer("plr_a"),
      matches,
      T0 + 30,
    );
    expect(ann.total).toBe(100);
    expect(ann.wins).toBe(1);
  });
});

describe("withdrawals on the other surfaces", () => {
  it("counts withdrawn matches in a tournament report", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    play(service, "mch_2", "plr_a", "plr_c", T0 + 20);
    service.voidMatch({ matchId: "mch_1", reason: "wrong winner", at: T0 + 30 });
    const report = buildTournamentReport(
      service.getTournament("tnm_cup"),
      service.leaderboard("tnm_cup").entries,
      [],
      store.listScores("tnm_cup"),
      store.listMatches("tnm_cup"),
    );
    expect(report.withdrawn).toBe(1);
  });

  it("voids over http and from the command line", async () => {
    const { router, service } = createArena();
    service.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_a", T0 + 2);
    service.register("tnm_cup", "plr_b", T0 + 3);
    service.start("tnm_cup", T0 + 5);
    play(service, "mch_1", "plr_a", "plr_b", T0 + 10);
    const response = await router.handle("POST", "/matches/mch_1/void", {
      reason: "wrong winner",
      at: T0 + 20,
    });
    expect(response.status).toBe(200);
    const conflict = await router.handle("POST", "/matches/mch_1/void", {
      reason: "again",
      at: T0 + 21,
    });
    expect(conflict.status).toBe(409);

    let output = "";
    const code = await runCli(["match:void", "--id", "mch_x", "--reason", "nope", "--at", "1"], (text) => {
      output += text;
    });
    expect(code).toBe(1);
    expect(output).toContain("mch_x");
  });
});
