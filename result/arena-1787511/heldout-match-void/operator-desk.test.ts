import { describe, expect, it } from "vitest";
import { createArena } from "../../src/api/server.js";
import { ArenaFlowSdk } from "../../src/sdk/index.js";
import { runCli } from "../../src/cli/index.js";
import { availableCommands } from "../../src/cli/commands/index.js";
import { MATCH_COMMANDS } from "../../src/cli/commands/match.js";
import { isKnownCode } from "../../src/engine/catalog/index.js";
import { buildTournamentReport, renderReport } from "../../src/engine/reporting/index.js";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";

const T0 = 1_700_200_000_000;

async function desk() {
  const { router, service } = createArena();
  await router.handle("POST", "/players", { id: "plr_ida", displayName: "Ida", createdAt: T0 });
  await router.handle("POST", "/players", { id: "plr_joe", displayName: "Joe", createdAt: T0 });
  await router.handle("POST", "/tournaments", { id: "tnm_open", name: "Open", format: "leaderboard", createdAt: T0 });
  await router.handle("POST", "/tournaments/tnm_open/open", { at: T0 + 1 });
  await router.handle("POST", "/tournaments/tnm_open/register", { playerId: "plr_ida", at: T0 + 2 });
  await router.handle("POST", "/tournaments/tnm_open/register", { playerId: "plr_joe", at: T0 + 3 });
  await router.handle("POST", "/tournaments/tnm_open/start", { at: T0 + 4 });
  const players = ["plr_ida", "plr_joe"];
  await router.handle("POST", "/matches", { id: "mch_open1", tournamentId: "tnm_open", playerIds: players, createdAt: T0 + 5 });
  await router.handle("POST", "/matches/mch_open1/start", { at: T0 + 6 });
  await router.handle("POST", "/matches/mch_open1/result", { winnerId: "plr_ida", loserId: "plr_joe", at: T0 + 7 });
  return { router, service };
}

describe("withdrawal over http", () => {
  it("answers with the match once it has left play", async () => {
    const { router } = await desk();
    const response = await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 20, reason: "server fault" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "mch_open1", status: "voided" });
  });

  it("turns a missing reason into a bad request", async () => {
    const { router } = await desk();
    const response = await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 20 });
    expect(response.status).toBe(400);
  });

  it("turns a repeated withdrawal into a conflict", async () => {
    const { router } = await desk();
    await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 20, reason: "server fault" });
    const again = await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 21, reason: "server fault" });
    expect(again.status).toBe(409);
  });

  it("turns a withdrawal after the end into a conflict", async () => {
    const { router } = await desk();
    await router.handle("POST", "/tournaments/tnm_open/end", { at: T0 + 10 });
    const late = await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 20, reason: "server fault" });
    expect(late.status).toBe(409);
  });

  it("lists what a tournament has withdrawn", async () => {
    const { router } = await desk();
    await router.handle("POST", "/matches/mch_open1/void", { at: T0 + 20, reason: "server fault" });
    const response = await router.handle("GET", "/tournaments/tnm_open/voids");
    expect(response.status).toBe(200);
    const entries = response.body as Array<{ matchId: string; reason: string; changes: unknown[] }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.matchId).toBe("mch_open1");
    expect(entries[0]?.reason).toBe("server fault");
    expect(entries[0]?.changes).toHaveLength(2);
  });
});

describe("published boards over http", () => {
  it("publishes the board an operator stands behind", async () => {
    const { router } = await desk();
    const response = await router.handle("POST", "/leaderboards/tnm_open/publish", { at: T0 + 30 });
    expect(response.status).toBe(200);
    const published = response.body as { at: number; board: { entries: Array<{ playerId: string }> } };
    expect(published.at).toBe(T0 + 30);
    expect(published.board.entries[0]?.playerId).toBe("plr_ida");
  });

  it("has nothing published until something is", async () => {
    const { router } = await desk();
    expect((await router.handle("GET", "/leaderboards/tnm_open/published")).status).toBe(404);
    await router.handle("POST", "/leaderboards/tnm_open/publish", { at: T0 + 30 });
    const response = await router.handle("GET", "/leaderboards/tnm_open/published");
    expect(response.status).toBe(200);
    expect((response.body as { at: number }).at).toBe(T0 + 30);
  });
});

describe("withdrawal through the sdk", () => {
  it("withdraws a result and reads the ledger back", async () => {
    const sdk = ArenaFlowSdk.inMemory();
    await sdk.players.create({ id: "plr_ida", displayName: "Ida", createdAt: T0 });
    await sdk.players.create({ id: "plr_joe", displayName: "Joe", createdAt: T0 });
    await sdk.tournaments.create({ id: "tnm_open", name: "Open", format: "leaderboard", createdAt: T0 });
    await sdk.tournaments.open("tnm_open", T0 + 1);
    await sdk.tournaments.register("tnm_open", "plr_ida", T0 + 2);
    await sdk.tournaments.register("tnm_open", "plr_joe", T0 + 3);
    await sdk.tournaments.start("tnm_open", T0 + 4);
    const roster = ["plr_ida", "plr_joe"];
    await sdk.matches.create({ id: "mch_open1", tournamentId: "tnm_open", playerIds: roster, createdAt: T0 + 5 });
    await sdk.matches.start("mch_open1", T0 + 6);
    await sdk.matches.submitResult("mch_open1", { winnerId: "plr_ida", loserId: "plr_joe", at: T0 + 7 });
    const published = await sdk.rankings.publish("tnm_open", T0 + 10);
    expect(published.at).toBe(T0 + 10);
    expect((await sdk.rankings.published("tnm_open")).at).toBe(T0 + 10);
    const voided = await sdk.matches.voidMatch("mch_open1", T0 + 20, "server fault");
    expect(voided.status).toBe("voided");
    const entries = await sdk.tournaments.voids("tnm_open");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reason).toBe("server fault");
    expect((await sdk.rankings.leaderboard("tnm_open")).entries[0]?.score).toBe(0);
  });
});

describe("withdrawal from the command line", () => {
  it("offers the commands the desk needs", () => {
    const commands = availableCommands();
    for (const command of [
      "match:void",
      "tournament:voids",
      "leaderboard:publish",
      "leaderboard:published",
    ]) {
      expect(commands).toContain(command);
    }
    expect(MATCH_COMMANDS).toContain("match:void");
  });

  it("prints the new commands in its help", async () => {
    let help = "";
    await runCli(["help"], (text) => {
      help += text;
    });
    expect(help).toContain("match:void");
    expect(help).toContain("leaderboard:publish");
  });

  it("insists on a reason when a result is withdrawn", async () => {
    let output = "";
    const code = await runCli(["match:void", "--id", "mch_open1", "--at", String(T0)], (text) => {
      output += text;
    });
    expect(code).toBe(1);
    expect(output).toContain("--reason");
  });
});

describe("withdrawal reasons and reports", () => {
  it("registers its explanation codes in the catalog", () => {
    expect(isKnownCode("match.voided")).toBe(true);
    expect(isKnownCode("score.rebuilt")).toBe(true);
    expect(isKnownCode("rank.published")).toBe(true);
  });

  it("prints what a tournament withdrew", () => {
    const store = new MemoryPersistence();
    const service = new TournamentService(store);
    service.createPlayer({ id: "plr_ida", displayName: "Ida", createdAt: T0 });
    service.createPlayer({ id: "plr_joe", displayName: "Joe", createdAt: T0 });
    service.createTournament({ id: "tnm_open", name: "Open", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm_open", T0 + 1);
    service.register("tnm_open", "plr_ida", T0 + 2);
    service.register("tnm_open", "plr_joe", T0 + 3);
    service.start("tnm_open", T0 + 4);
    service.createMatch({ id: "mch_open1", tournamentId: "tnm_open", playerIds: ["plr_ida", "plr_joe"], createdAt: T0 + 5 });
    service.startMatch("mch_open1", T0 + 6);
    service.submitPairResult({ matchId: "mch_open1", winnerId: "plr_ida", loserId: "plr_joe", at: T0 + 7 });
    service.voidMatch({ matchId: "mch_open1", at: T0 + 20, reason: "server fault" });
    const report = buildTournamentReport(
      service.getTournament("tnm_open"),
      service.leaderboard("tnm_open").entries,
      [],
      store.listScores("tnm_open"),
      service.voidHistory("tnm_open"),
    );
    expect(report.voids).toHaveLength(1);
    const rendered = renderReport(report);
    expect(rendered).toContain("mch_open1");
    expect(rendered).toContain("server fault");
  });
});
