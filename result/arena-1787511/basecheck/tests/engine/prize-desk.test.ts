import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { isArenaFlowError, type ArenaFlowErrorCode } from "../../src/errors.js";

const T0 = 1_700_400_000_000;
const GRANT = T0 + 300;

function cup(claimWindowMs?: number): {
  store: MemoryPersistence;
  service: TournamentService;
} {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  service.createPlayer({ id: "plr_ada", displayName: "Ada", createdAt: T0 });
  service.createPlayer({ id: "plr_bo", displayName: "Bo", createdAt: T0 });
  service.createPlayer({ id: "plr_cy", displayName: "Cy", createdAt: T0 });
  service.createTournament({
    id: "tnm_open",
    name: "Open",
    format: "leaderboard",
    createdAt: T0,
    rewards: {
      prizePool: 1000,
      claimWindowMs,
      tiers: [
        { name: "gold", minRank: 1, maxRank: 1, amount: 0, shareOfPool: 0.7 },
        { name: "bronze", minRank: 2, maxRank: 2, amount: 300, shareOfPool: undefined },
      ],
    },
  });
  service.openRegistration("tnm_open", T0 + 1);
  service.register("tnm_open", "plr_ada", T0 + 2);
  service.register("tnm_open", "plr_bo", T0 + 3);
  service.register("tnm_open", "plr_cy", T0 + 4);
  service.start("tnm_open", T0 + 5);
  return { store, service };
}

/** Ada first, Bo second, Cy out of the tiers, then the payout runs. */
function paid(claimWindowMs?: number) {
  const arena = cup(claimWindowMs);
  const { service } = arena;
  for (const [id, winner, loser, at] of [
    ["mch_1", "plr_ada", "plr_bo", T0 + 10],
    ["mch_2", "plr_ada", "plr_cy", T0 + 20],
    ["mch_3", "plr_bo", "plr_cy", T0 + 30],
  ] as const) {
    service.createMatch({ id, tournamentId: "tnm_open", playerIds: [winner, loser], createdAt: at });
    service.startMatch(id, at + 1);
    service.submitPairResult({ matchId: id, winnerId: winner, loserId: loser, at: at + 2 });
  }
  service.end("tnm_open", T0 + 200);
  const rewards = service.distributeRewards("tnm_open", GRANT);
  return { ...arena, rewards };
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

function statusOf(store: MemoryPersistence, rewardId: string): string | undefined {
  return store.listRewards().find((reward) => reward.id === rewardId)?.status;
}

describe("taking one reward back", () => {
  it("revokes it and keeps the record", () => {
    const { store, service, rewards } = paid();
    const revoked = service.revokeReward(rewards[0]!.id, T0 + 400, "flagged by review");
    expect(revoked.status).toBe("revoked");
    expect(revoked.amount).toBe(700);
    expect(store.listRewards()).toHaveLength(2);
    expect(statusOf(store, rewards[0]!.id)).toBe("revoked");
    expect(statusOf(store, rewards[1]!.id)).toBe("granted");
  });

  it("records it on the reward's own stream", () => {
    const { store, service, rewards } = paid();
    service.revokeReward(rewards[0]!.id, T0 + 400, "flagged by review");
    const events = store.journal
      .readStream(`reward:${rewards[0]!.id}`)
      .filter((event) => event.type === "RewardRevoked");
    expect(events).toHaveLength(1);
    expect(events[0]?.at).toBe(T0 + 400);
    expect(events[0]?.payload).toMatchObject({
      rewardId: rewards[0]!.id,
      playerId: "plr_ada",
      reason: "flagged by review",
    });
  });

  it("needs a reason", () => {
    const { service, rewards } = paid();
    expect(failureCode(() => service.revokeReward(rewards[0]!.id, T0 + 400, "   "))).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("refuses a reward nobody granted", () => {
    const { service } = paid();
    expect(failureCode(() => service.revokeReward("rwd_ghost", T0 + 400, "review"))).toBe(
      "NOT_FOUND",
    );
  });

  it("refuses the same reward twice", () => {
    const { service, rewards } = paid();
    service.revokeReward(rewards[0]!.id, T0 + 400, "review");
    expect(failureCode(() => service.revokeReward(rewards[0]!.id, T0 + 401, "review"))).toBe(
      "CONFLICT",
    );
  });

  it("refuses a prize somebody already took", () => {
    const { service, rewards } = paid();
    service.claimReward(rewards[0]!.id, T0 + 350);
    expect(failureCode(() => service.revokeReward(rewards[0]!.id, T0 + 400, "review"))).toBe(
      "ILLEGAL_STATE",
    );
  });
});

describe("taking a payout back", () => {
  it("recalls every reward the tournament still holds", () => {
    const { store, service } = paid();
    const recalled = service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    expect(recalled.map((reward) => reward.id)).toEqual(
      [...store.listRewards()].map((reward) => reward.id),
    );
    expect(recalled.every((reward) => reward.status === "revoked")).toBe(true);
    expect(store.listRewards().every((reward) => reward.status === "revoked")).toBe(true);
  });

  it("takes nothing back when one prize has been claimed", () => {
    const { store, service, rewards } = paid();
    service.claimReward(rewards[0]!.id, T0 + 350);
    expect(failureCode(() => service.recallRewards("tnm_open", T0 + 400, "pool was wrong"))).toBe(
      "CONFLICT",
    );
    expect(statusOf(store, rewards[0]!.id)).toBe("claimed");
    expect(statusOf(store, rewards[1]!.id)).toBe("granted");
  });

  it("has nothing to do twice over", () => {
    const { service } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    expect(service.recallRewards("tnm_open", T0 + 401, "pool was wrong")).toHaveLength(0);
  });

  it("needs a reason of its own", () => {
    const { service } = paid();
    expect(failureCode(() => service.recallRewards("tnm_open", T0 + 400, ""))).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("paying a tournament again", () => {
  it("refuses while the payout still stands", () => {
    const { service } = paid();
    expect(failureCode(() => service.distributeRewards("tnm_open", T0 + 400))).toBe("CONFLICT");
  });

  it("still refuses when only part of the payout came back", () => {
    const { service, rewards } = paid();
    service.revokeReward(rewards[0]!.id, T0 + 400, "review");
    expect(failureCode(() => service.distributeRewards("tnm_open", T0 + 401))).toBe("CONFLICT");
  });

  it("mints a second round once the payout is recalled", () => {
    const { service, rewards } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    const second = service.distributeRewards("tnm_open", T0 + 500);
    expect(second.map((reward) => reward.id)).toEqual(
      rewards.map((reward) => `${reward.id}_r2`),
    );
    expect(second.every((reward) => reward.status === "granted")).toBe(true);
  });

  it("leaves the round it replaced where it was", () => {
    const { store, service, rewards } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    service.distributeRewards("tnm_open", T0 + 500);
    expect(store.listRewards()).toHaveLength(4);
    expect(statusOf(store, rewards[0]!.id)).toBe("revoked");
    expect(statusOf(store, `${rewards[0]!.id}_r2`)).toBe("granted");
  });

  it("counts on to a third round", () => {
    const { service, rewards } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    service.distributeRewards("tnm_open", T0 + 500);
    service.recallRewards("tnm_open", T0 + 600, "wrong again");
    const third = service.distributeRewards("tnm_open", T0 + 700);
    expect(third.map((reward) => reward.id)).toEqual(
      rewards.map((reward) => `${reward.id}_r3`),
    );
  });

  it("pays the same tiers the config always paid", () => {
    const { service } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    const second = service.distributeRewards("tnm_open", T0 + 500);
    expect(second.map((reward) => [reward.playerId, reward.tier, reward.amount])).toEqual([
      ["plr_ada", "gold", 700],
      ["plr_bo", "bronze", 300],
    ]);
  });
});

describe("claim windows", () => {
  it("lets a prize be taken inside the window", () => {
    const { service, rewards } = paid(1000);
    expect(service.claimReward(rewards[0]!.id, GRANT + 500).status).toBe("claimed");
  });

  it("counts the deadline itself as inside", () => {
    const { service, rewards } = paid(1000);
    expect(service.claimReward(rewards[0]!.id, GRANT + 1000).status).toBe("claimed");
  });

  it("refuses one millisecond later", () => {
    const { service, rewards } = paid(1000);
    expect(failureCode(() => service.claimReward(rewards[0]!.id, GRANT + 1001))).toBe(
      "ILLEGAL_STATE",
    );
  });

  it("never closes when the config sets no window", () => {
    const { service, rewards } = paid();
    expect(service.claimReward(rewards[0]!.id, GRANT + 9_000_000).status).toBe("claimed");
  });

  it("refuses a prize that came back", () => {
    const { service, rewards } = paid(1000);
    service.revokeReward(rewards[0]!.id, GRANT + 10, "review");
    expect(failureCode(() => service.claimReward(rewards[0]!.id, GRANT + 20))).toBe(
      "ILLEGAL_STATE",
    );
  });

  it("refuses a reward nobody granted", () => {
    const { service } = paid(1000);
    expect(failureCode(() => service.claimReward("rwd_ghost", GRANT + 20))).toBe("NOT_FOUND");
  });
});

describe("closing out what nobody came for", () => {
  it("revokes everything past its deadline", () => {
    const { store, service, rewards } = paid(1000);
    const expired = service.expireClaims("tnm_open", GRANT + 1001);
    expect(expired.map((reward) => reward.id)).toEqual(rewards.map((reward) => reward.id));
    expect(store.listRewards().every((reward) => reward.status === "revoked")).toBe(true);
  });

  it("leaves a prize somebody took", () => {
    const { store, service, rewards } = paid(1000);
    service.claimReward(rewards[0]!.id, GRANT + 10);
    const expired = service.expireClaims("tnm_open", GRANT + 1001);
    expect(expired.map((reward) => reward.id)).toEqual([rewards[1]!.id]);
    expect(statusOf(store, rewards[0]!.id)).toBe("claimed");
  });

  it("does nothing before the deadline", () => {
    const { service } = paid(1000);
    expect(service.expireClaims("tnm_open", GRANT + 1000)).toHaveLength(0);
  });

  it("does nothing at all without a window", () => {
    const { service } = paid();
    expect(service.expireClaims("tnm_open", GRANT + 9_000_000)).toHaveLength(0);
  });
});

describe("reading the payout back", () => {
  it("states one round with what it handed out", () => {
    const { service } = paid();
    const statement = service.payoutStatement("tnm_open");
    expect(statement.tournamentId).toBe("tnm_open");
    expect(statement.rounds).toHaveLength(1);
    expect(statement.rounds[0]).toMatchObject({
      round: 1,
      grantedAt: GRANT,
      granted: 1000,
      standing: 1000,
    });
    expect(statement.rounds[0]?.rewards).toHaveLength(2);
  });

  it("states nothing at all before a tournament pays", () => {
    const { service } = cup();
    const statement = service.payoutStatement("tnm_open");
    expect(statement.rounds).toHaveLength(0);
    expect(statement.recalled).toBe(0);
    expect(statement.outstanding).toBe(0);
    expect(statement.paid).toBe(0);
  });

  it("shows a recalled round standing at nothing", () => {
    const { service } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    const statement = service.payoutStatement("tnm_open");
    expect(statement.rounds[0]?.granted).toBe(1000);
    expect(statement.rounds[0]?.standing).toBe(0);
    expect(statement.recalled).toBe(1000);
    expect(statement.outstanding).toBe(0);
  });

  it("keeps both rounds, oldest first", () => {
    const { service } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    service.distributeRewards("tnm_open", T0 + 500);
    const statement = service.payoutStatement("tnm_open");
    expect(statement.rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(statement.rounds.map((round) => round.grantedAt)).toEqual([GRANT, T0 + 500]);
    expect(statement.rounds.map((round) => round.standing)).toEqual([0, 1000]);
    expect(statement.recalled).toBe(1000);
    expect(statement.outstanding).toBe(1000);
  });

  it("splits what was paid from what is owed", () => {
    const { service, rewards } = paid();
    service.claimReward(rewards[0]!.id, T0 + 350);
    const statement = service.payoutStatement("tnm_open");
    expect(statement.paid).toBe(700);
    expect(statement.outstanding).toBe(300);
    expect(statement.recalled).toBe(0);
  });
});

describe("what a player is owed", () => {
  it("counts a granted prize as waiting", () => {
    const { service } = paid();
    expect(service.rewardBalance("plr_ada")).toMatchObject({ claimed: 0, pending: 700 });
    expect(service.rewardBalance("plr_cy")).toMatchObject({ claimed: 0, pending: 0 });
  });

  it("counts a taken prize as paid", () => {
    const { service, rewards } = paid();
    service.claimReward(rewards[0]!.id, T0 + 350);
    expect(service.rewardBalance("plr_ada")).toMatchObject({ claimed: 700, pending: 0 });
  });

  it("counts a recalled prize as neither", () => {
    const { service } = paid();
    service.recallRewards("tnm_open", T0 + 400, "pool was wrong");
    expect(service.rewardBalance("plr_ada")).toMatchObject({ claimed: 0, pending: 0 });
    expect(service.rewardBalance("plr_bo")).toMatchObject({ claimed: 0, pending: 0 });
  });

  it("refuses a player nobody created", () => {
    const { service } = paid();
    expect(failureCode(() => service.rewardBalance("plr_ghost"))).toBe("NOT_FOUND");
  });
});
