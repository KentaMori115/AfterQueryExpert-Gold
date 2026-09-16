import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { replayJournal } from "../../src/events/replay/replay.js";
import { createArena } from "../../src/api/server.js";
import { ArenaFlowSdk } from "../../src/sdk/index.js";
import { availableCommands, runCommand } from "../../src/cli/commands/index.js";
import { runCli } from "../../src/cli/index.js";
import { buildTournamentReport } from "../../src/engine/reporting/index.js";
import type { ScoreRecord } from "../../src/types.js";

const T0 = 1_700_000_000_000;

function arena() {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
  service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0, vip: true });
  service.createPlayer({ id: "plr_cal", displayName: "Cal", createdAt: T0 });
  service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
  service.openRegistration("tnm_cup", T0 + 1);
  service.register("tnm_cup", "plr_ann", T0 + 2);
  service.register("tnm_cup", "plr_ben", T0 + 3);
  service.register("tnm_cup", "plr_cal", T0 + 4);
  service.start("tnm_cup", T0 + 6);
  return { store, service };
}

function play(
  service: TournamentService,
  id: string,
  winner: string,
  loser: string,
  at: number,
): void {
  service.createMatch({ id, tournamentId: "tnm_cup", playerIds: [winner, loser], createdAt: at - 2 });
  service.startMatch(id, at - 1);
  service.submitPairResult({ matchId: id, winnerId: winner, loserId: loser, at });
}

function seeded(): { store: MemoryPersistence; service: TournamentService } {
  const { store, service } = arena();
  play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
  play(service, "mch_2", "plr_ann", "plr_cal", T0 + 200);
  play(service, "mch_3", "plr_ben", "plr_ann", T0 + 300);
  return { store, service };
}

function compare(live: readonly ScoreRecord[], projected: ReadonlyMap<string, ScoreRecord>): void {
  for (const score of live) {
    const other = projected.get(`${score.tournamentId}::${score.playerId}`);
    expect(other?.total).toBeCloseTo(score.total, 6);
    expect(other?.wins).toBe(score.wins);
    expect(other?.losses).toBe(score.losses);
    expect(other?.streak).toBe(score.streak);
    expect(other?.bestStreak).toBe(score.bestStreak);
    expect(other?.lastUpdatedAt).toBe(score.lastUpdatedAt);
  }
}

describe("the event a withdrawal writes", () => {
  it("lands on the match stream carrying the reason", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const events = store.journal.readStream("match:mch_2");
    const last = events[events.length - 1];
    expect(last?.type).toBe("MatchVoided");
    expect(last?.at).toBe(T0 + 500);
    expect((last?.payload as { reason?: string }).reason).toBe("opponent disconnected");
    expect((last?.payload as { matchId?: string }).matchId).toBe("mch_2");
  });

  it("leaves the streams of the matches it did not touch alone", () => {
    const { store, service } = seeded();
    const before = store.journal.readStream("match:mch_1").length;
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    expect(store.journal.readStream("match:mch_1")).toHaveLength(before);
  });
});

describe("replaying a withdrawal", () => {
  it("reaches the scores the live run left behind", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const replayed = replayJournal(store.journal);
    compare(store.listScores("tnm_cup"), replayed.scores);
  });

  it("marks the match voided in the projection too", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const replayed = replayJournal(store.journal);
    expect(replayed.matches.get("mch_2")?.status).toBe("voided");
    expect(replayed.matches.get("mch_1")?.status).toBe("completed");
  });

  it("reaches the same scores after two withdrawals", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_1", reason: "opponent disconnected", at: T0 + 500 });
    service.voidMatch({ matchId: "mch_3", reason: "misreported", at: T0 + 600 });
    const replayed = replayJournal(store.journal);
    expect(replayed.scores.get("tnm_cup::plr_ann")?.total).toBe(100);
    compare(store.listScores("tnm_cup"), replayed.scores);
  });

  it("survives a reload of the store", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const live = store.listScores("tnm_cup");
    store.load();
    compare(live, store.load().scores);
    expect(store.listScores("tnm_cup").map((score) => score.total)).toEqual(
      live.map((score) => score.total),
    );
  });

  it("empties the same player the live run emptied", () => {
    const { store, service } = arena();
    play(service, "mch_1", "plr_ann", "plr_cal", T0 + 100);
    play(service, "mch_2", "plr_ann", "plr_ben", T0 + 200);
    service.voidMatch({ matchId: "mch_1", reason: "opponent disconnected", at: T0 + 500 });
    const replayed = replayJournal(store.journal);
    const cal = replayed.scores.get("tnm_cup::plr_cal");
    expect(cal?.total).toBe(0);
    expect(cal?.losses).toBe(0);
    expect(cal?.lastUpdatedAt).toBe(T0 + 500);
    compare(store.listScores("tnm_cup"), replayed.scores);
  });

  it("orders matches settled together the same way the live run did", () => {
    const { store, service } = arena();
    play(service, "mch_z", "plr_ann", "plr_cal", T0 + 100);
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
    service.voidMatch({ matchId: "mch_z", reason: "opponent disconnected", at: T0 + 500 });
    const replayed = replayJournal(store.journal);
    expect(replayed.scores.get("tnm_cup::plr_ann")?.streak).toBe(0);
    expect(replayed.scores.get("tnm_cup::plr_ann")?.bestStreak).toBe(1);
    compare(store.listScores("tnm_cup"), replayed.scores);
  });

  it("continues from a snapshot taken before the withdrawal", () => {
    const { store, service } = seeded();
    const snapshot = store.checkpoint(T0 + 400);
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const restored = store.snapshots.restore(snapshot.id);
    const replayed = replayJournal(store.journal, { fromState: restored });
    compare(store.listScores("tnm_cup"), replayed.scores);
  });
});

describe("withdrawing over the other surfaces", () => {
  it("withdraws over http and answers with the rebuilt records", async () => {
    const { router, service } = createArena();
    service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_ann", T0 + 2);
    service.register("tnm_cup", "plr_ben", T0 + 3);
    service.start("tnm_cup", T0 + 6);
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    const response = await router.handle("POST", "/matches/mch_1/void", {
      reason: "opponent disconnected",
      at: T0 + 500,
    });
    expect(response.status).toBe(200);
    const body = response.body as { reason: string; rebuilt: ScoreRecord[] };
    expect(body.reason).toBe("opponent disconnected");
    expect(body.rebuilt.map((score) => score.playerId)).toEqual(["plr_ann", "plr_ben"]);
  });

  it("maps a refused withdrawal onto its usual status", async () => {
    const { router, service } = createArena();
    service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
    service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0 });
    service.createTournament({ id: "tnm_cup", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_cup", T0 + 1);
    service.register("tnm_cup", "plr_ann", T0 + 2);
    service.register("tnm_cup", "plr_ben", T0 + 3);
    service.start("tnm_cup", T0 + 6);
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    const blank = await router.handle("POST", "/matches/mch_1/void", { reason: " ", at: T0 + 500 });
    expect(blank.status).toBe(400);
    const missing = await router.handle("POST", "/matches/mch_x/void", {
      reason: "misreported",
      at: T0 + 500,
    });
    expect(missing.status).toBe(404);
    await router.handle("POST", "/matches/mch_1/void", { reason: "misreported", at: T0 + 500 });
    const again = await router.handle("POST", "/matches/mch_1/void", {
      reason: "misreported",
      at: T0 + 600,
    });
    expect(again.status).toBe(409);
  });

  it("withdraws through the sdk", async () => {
    const sdk = ArenaFlowSdk.inMemory();
    await sdk.players.create({ id: "plr_ann", displayName: "Ann", createdAt: T0 });
    await sdk.players.create({ id: "plr_ben", displayName: "Ben", createdAt: T0 });
    await sdk.tournaments.create({
      id: "tnm_cup",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
    });
    await sdk.tournaments.open("tnm_cup", T0 + 1);
    await sdk.tournaments.register("tnm_cup", "plr_ann", T0 + 2);
    await sdk.tournaments.register("tnm_cup", "plr_ben", T0 + 3);
    await sdk.tournaments.start("tnm_cup", T0 + 6);
    await sdk.matches.create({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_ann", "plr_ben"],
      createdAt: T0 + 98,
    });
    await sdk.matches.start("mch_1", T0 + 99);
    await sdk.matches.submitResult("mch_1", {
      winnerId: "plr_ann",
      loserId: "plr_ben",
      at: T0 + 100,
    });
    const withdrawal = (await sdk.matches.voidMatch("mch_1", {
      reason: "opponent disconnected",
      at: T0 + 500,
    })) as unknown as { match: { status: string }; rebuilt: ScoreRecord[] };
    expect(withdrawal.match.status).toBe("voided");
    expect(withdrawal.rebuilt).toHaveLength(2);
    const board = await sdk.rankings.leaderboard("tnm_cup");
    expect(board.entries.every((entry) => entry.score === 0)).toBe(true);
  });

  it("offers the withdrawal on the command line", async () => {
    const { service } = arena();
    play(service, "mch_1", "plr_ann", "plr_ben", T0 + 100);
    expect(availableCommands()).toContain("match:void");
    let help = "";
    await runCli(["help"], (text) => {
      help += text;
    });
    expect(help).toContain("match:void");
    const result = (await runCommand(
      "match:void",
      { id: "mch_1", reason: "opponent disconnected", at: String(T0 + 500) },
      service,
    )) as { match: { status: string } };
    expect(result.match.status).toBe("voided");
  });

  it("counts what a tournament had withdrawn", () => {
    const { store, service } = seeded();
    service.voidMatch({ matchId: "mch_2", reason: "opponent disconnected", at: T0 + 500 });
    const report = buildTournamentReport(
      service.getTournament("tnm_cup"),
      service.leaderboard("tnm_cup").entries,
      [],
      store.listScores("tnm_cup"),
      store.listMatches("tnm_cup"),
    );
    expect(report.withdrawn).toBe(1);
    expect(report.registered).toBe(3);
  });
});
