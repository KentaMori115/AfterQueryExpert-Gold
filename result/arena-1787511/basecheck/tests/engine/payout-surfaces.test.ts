import { describe, expect, it } from "vitest";
import { createArena } from "../../src/api/server.js";
import { ArenaFlowSdk } from "../../src/sdk/index.js";
import { runCli } from "../../src/cli/index.js";
import { availableCommands } from "../../src/cli/commands/index.js";
import { REWARD_COMMANDS } from "../../src/cli/commands/reward.js";
import type { TournamentService } from "../../src/engine/tournament/index.js";
import type { RewardRecord } from "../../src/types.js";

const T0 = 1_700_500_000_000;
const GRANT = T0 + 300;

function seed(service: TournamentService, claimWindowMs?: number): void {
  service.createPlayer({ id: "plr_ada", displayName: "Ada", createdAt: T0 });
  service.createPlayer({ id: "plr_bo", displayName: "Bo", createdAt: T0 });
  service.createTournament({
    id: "tnm_open",
    name: "Open",
    format: "leaderboard",
    createdAt: T0,
    rewards: {
      prizePool: 1000,
      claimWindowMs,
      tiers: [
        { name: "gold", minRank: 1, maxRank: 1, amount: 700, shareOfPool: undefined },
        { name: "bronze", minRank: 2, maxRank: 2, amount: 300, shareOfPool: undefined },
      ],
    },
  });
  service.openRegistration("tnm_open", T0 + 1);
  service.register("tnm_open", "plr_ada", T0 + 2);
  service.register("tnm_open", "plr_bo", T0 + 3);
  service.start("tnm_open", T0 + 4);
  service.createMatch({ id: "mch_1", tournamentId: "tnm_open", playerIds: ["plr_ada", "plr_bo"], createdAt: T0 + 10 });
  service.startMatch("mch_1", T0 + 11);
  service.submitPairResult({ matchId: "mch_1", winnerId: "plr_ada", loserId: "plr_bo", at: T0 + 12 });
  service.end("tnm_open", T0 + 200);
}

function desk(claimWindowMs?: number) {
  const { router, service } = createArena();
  seed(service, claimWindowMs);
  const rewards = service.distributeRewards("tnm_open", GRANT);
  return { router, service, rewards };
}

describe("payouts over http", () => {
  it("takes a prize on request", async () => {
    const { router, rewards } = desk(1000);
    const response = await router.handle("POST", `/rewards/${rewards[0]!.id}/claim`, { at: GRANT + 10 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: rewards[0]!.id, status: "claimed" });
  });

  it("turns a closed window into a conflict", async () => {
    const { router, rewards } = desk(1000);
    const response = await router.handle("POST", `/rewards/${rewards[0]!.id}/claim`, { at: GRANT + 1001 });
    expect(response.status).toBe(409);
  });

  it("has nothing to hand a reward nobody granted", async () => {
    const { router } = desk();
    expect((await router.handle("POST", "/rewards/rwd_ghost/claim", { at: T0 + 400 })).status).toBe(404);
  });

  it("revokes one reward and refuses a claimed one", async () => {
    const { router, rewards } = desk();
    const revoked = await router.handle("POST", `/rewards/${rewards[0]!.id}/revoke`, {
      at: T0 + 400,
      reason: "flagged by review",
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ status: "revoked" });
    await router.handle("POST", `/rewards/${rewards[1]!.id}/claim`, { at: T0 + 401 });
    const refused = await router.handle("POST", `/rewards/${rewards[1]!.id}/revoke`, {
      at: T0 + 402,
      reason: "flagged by review",
    });
    expect(refused.status).toBe(409);
  });

  it("turns a missing reason into a bad request", async () => {
    const { router, rewards } = desk();
    const response = await router.handle("POST", `/rewards/${rewards[0]!.id}/revoke`, { at: T0 + 400 });
    expect(response.status).toBe(400);
  });

  it("recalls a whole payout", async () => {
    const { router } = desk();
    const response = await router.handle("POST", "/rewards/recall", {
      tournamentId: "tnm_open",
      at: T0 + 400,
      reason: "pool was wrong",
    });
    expect(response.status).toBe(200);
    const recalled = response.body as RewardRecord[];
    expect(recalled).toHaveLength(2);
    expect(recalled.every((reward) => reward.status === "revoked")).toBe(true);
  });

  it("refuses a recall over a claimed prize", async () => {
    const { router, rewards } = desk();
    await router.handle("POST", `/rewards/${rewards[0]!.id}/claim`, { at: T0 + 350 });
    const response = await router.handle("POST", "/rewards/recall", {
      tournamentId: "tnm_open",
      at: T0 + 400,
      reason: "pool was wrong",
    });
    expect(response.status).toBe(409);
  });

  it("closes out what nobody came for", async () => {
    const { router } = desk(1000);
    const response = await router.handle("POST", "/rewards/expire", {
      tournamentId: "tnm_open",
      at: GRANT + 1001,
    });
    expect(response.status).toBe(200);
    expect(response.body as RewardRecord[]).toHaveLength(2);
  });

  it("states the payout round by round", async () => {
    const { router } = desk();
    await router.handle("POST", "/rewards/recall", {
      tournamentId: "tnm_open",
      at: T0 + 400,
      reason: "pool was wrong",
    });
    await router.handle("POST", "/rewards/distribute", { tournamentId: "tnm_open", at: T0 + 500 });
    const response = await router.handle("GET", "/rewards/statement/tnm_open");
    expect(response.status).toBe(200);
    const statement = response.body as {
      rounds: Array<{ round: number; standing: number }>;
      recalled: number;
      outstanding: number;
    };
    expect(statement.rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(statement.recalled).toBe(1000);
    expect(statement.outstanding).toBe(1000);
  });

  it("answers a player's balance", async () => {
    const { router, rewards } = desk();
    await router.handle("POST", `/rewards/${rewards[0]!.id}/claim`, { at: T0 + 350 });
    const response = await router.handle("GET", "/rewards/plr_ada/balance");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ playerId: "plr_ada", claimed: 700, pending: 0 });
  });
});

describe("payouts through the sdk", () => {
  it("recalls, pays again, and reads both rounds back", async () => {
    const sdk = ArenaFlowSdk.inMemory();
    await sdk.players.create({ id: "plr_ada", displayName: "Ada", createdAt: T0 });
    await sdk.players.create({ id: "plr_bo", displayName: "Bo", createdAt: T0 });
    await sdk.tournaments.create({
      id: "tnm_open",
      name: "Open",
      format: "leaderboard",
      createdAt: T0,
      rewards: {
        prizePool: 1000,
        tiers: [
          { name: "gold", minRank: 1, maxRank: 1, amount: 700 },
          { name: "bronze", minRank: 2, maxRank: 2, amount: 300 },
        ],
      },
    } as Record<string, unknown>);
    await sdk.tournaments.open("tnm_open", T0 + 1);
    await sdk.tournaments.register("tnm_open", "plr_ada", T0 + 2);
    await sdk.tournaments.register("tnm_open", "plr_bo", T0 + 3);
    await sdk.tournaments.start("tnm_open", T0 + 4);
    await sdk.matches.create({
      id: "mch_1",
      tournamentId: "tnm_open",
      playerIds: ["plr_ada", "plr_bo"],
      createdAt: T0 + 10,
    });
    await sdk.matches.start("mch_1", T0 + 11);
    await sdk.matches.submitResult("mch_1", { winnerId: "plr_ada", loserId: "plr_bo", at: T0 + 12 });
    await sdk.tournaments.end("tnm_open", T0 + 200);
    const first = await sdk.rewards.distribute("tnm_open", GRANT);
    expect(first).toHaveLength(2);
    const recalled = await sdk.rewards.recall("tnm_open", T0 + 400, "pool was wrong");
    expect(recalled.every((reward) => reward.status === "revoked")).toBe(true);
    const second = await sdk.rewards.distribute("tnm_open", T0 + 500);
    expect(second[0]?.id).toBe(`${first[0]!.id}_r2`);
    const claimed = await sdk.rewards.claim(second[0]!.id, T0 + 510);
    expect(claimed.status).toBe("claimed");
    const revoked = await sdk.rewards.revoke(second[1]!.id, T0 + 520, "flagged by review");
    expect(revoked.status).toBe("revoked");
    expect(await sdk.rewards.expire("tnm_open", T0 + 530)).toHaveLength(0);
    const statement = await sdk.rewards.statement("tnm_open");
    expect(statement.rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(await sdk.rewards.balance("plr_ada")).toMatchObject({ claimed: 700, pending: 0 });
  });
});

describe("payouts from the command line", () => {
  it("offers the commands the desk needs", () => {
    const commands = availableCommands();
    for (const command of [
      "rewards:claim",
      "rewards:revoke",
      "rewards:recall",
      "rewards:expire",
      "rewards:statement",
      "rewards:balance",
    ]) {
      expect(commands).toContain(command);
      expect(REWARD_COMMANDS).toContain(command);
    }
  });

  it("prints them in its help", async () => {
    let help = "";
    await runCli(["help"], (text) => {
      help += text;
    });
    expect(help).toContain("rewards:recall");
    expect(help).toContain("rewards:balance");
  });

  it("insists on a reason when a payout is recalled", async () => {
    let output = "";
    const code = await runCli(["rewards:recall", "--id", "tnm_open", "--at", String(T0)], (text) => {
      output += text;
    });
    expect(code).toBe(1);
    expect(output).toContain("--reason");
  });

  it("insists on a player when a balance is read", async () => {
    let output = "";
    const code = await runCli(["rewards:balance"], (text) => {
      output += text;
    });
    expect(code).toBe(1);
    expect(output).toContain("--player");
  });
});
