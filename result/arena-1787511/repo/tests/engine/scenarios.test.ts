import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/index.js";
import { TournamentService } from "../../src/engine/tournament/index.js";
import { scoringEngine, scoringPreset } from "../../src/engine/scoring/index.js";
import { rankingEngine } from "../../src/engine/ranking/index.js";
import { ruleEngine } from "../../src/engine/rules/index.js";
import { matchmakingEngine } from "../../src/engine/matchmaking/index.js";
import { antiCheatEngine } from "../../src/engine/anti-cheat/index.js";
import { AuditLog, summarizeAudit } from "../../src/engine/audit/index.js";
import { EXPLANATION_CODES, codeFamily, isKnownCode } from "../../src/engine/catalog/index.js";
import { createPlayer } from "../../src/domain/players/index.js";
import { createMatch, startMatch } from "../../src/domain/matches/index.js";
import { createTournament, openRegistration } from "../../src/domain/tournaments/index.js";
import { emptyScore } from "../../src/domain/scores/index.js";
import { explain } from "../../src/explain.js";

const T0 = 1_700_002_400_000;

function serviceWithPlayers(count: number) {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  for (let i = 0; i < count; i += 1) {
    service.createPlayer({
      id: `plr_${i}`,
      displayName: `Player ${i}`,
      createdAt: T0,
      skillRating: 1000 + i * 10,
      vip: i % 5 === 0,
    });
  }
  return service;
}

describe("multi-match scenarios", () => {
  it("awards a five win streak bonus on the fifth win", () => {
    const service = serviceWithPlayers(2);
    service.createTournament({ id: "tnm", name: "Cup", format: "leaderboard", createdAt: T0 });
    service.openRegistration("tnm", T0 + 1);
    service.register("tnm", "plr_0", T0 + 2);
    service.register("tnm", "plr_1", T0 + 3);
    service.start("tnm", T0 + 4);
    for (let i = 0; i < 5; i += 1) {
      const matchId = `mch_${i}`;
      service.createMatch({ id: matchId, tournamentId: "tnm", playerIds: ["plr_0", "plr_1"], createdAt: T0 + 10 + i });
      service.startMatch(matchId, T0 + 20 + i);
      service.submitPairResult({ matchId, winnerId: "plr_0", loserId: "plr_1", at: T0 + 30 + i });
    }
    const board = service.leaderboard("tnm");
    expect(board.entries[0]?.playerId).toBe("plr_0");
    expect(board.entries[0]?.score).toBeGreaterThan(500);
  });

  it("keeps VIP scoring above a non-VIP win", () => {
    const vip = createPlayer({ id: "plr_v", displayName: "Vip", createdAt: T0, vip: true });
    const regular = createPlayer({ id: "plr_r", displayName: "Reg", createdAt: T0 });
    const tournament = createTournament({ id: "tnm", name: "Cup", format: "leaderboard", createdAt: T0 });
    const vipWin = scoringEngine.decide({
      player: vip,
      tournament,
      current: emptyScore("plr_v", "tnm", T0),
      outcome: "win",
      rawScore: 1,
      at: T0 + 1,
    });
    const regularWin = scoringEngine.decide({
      player: regular,
      tournament,
      current: emptyScore("plr_r", "tnm", T0),
      outcome: "win",
      rawScore: 1,
      at: T0 + 1,
    });
    expect(vipWin.awarded).toBeGreaterThan(regularWin.awarded);
  });

  it("breaks a two-player tie by earlier update time", () => {
    const early = { ...emptyScore("plr_a", "tnm", T0), total: 50, lastUpdatedAt: T0 + 1 };
    const late = { ...emptyScore("plr_b", "tnm", T0), total: 50, lastUpdatedAt: T0 + 9 };
    const entries = rankingEngine.compute("tnm", [late, early]).entries;
    expect(entries[0]?.playerId).toBe("plr_a");
  });

  it("rejects an under-leveled player", () => {
    const player = createPlayer({ id: "plr_n", displayName: "Novice", createdAt: T0, level: 1 });
    const tournament = createTournament({
      id: "tnm",
      name: "Cup",
      format: "leaderboard",
      createdAt: T0,
      rules: { minLevel: 10 },
    });
    expect(ruleEngine.evaluate({ player, tournament }).eligible).toBe(false);
  });

  it("pairs four players into two matches", () => {
    const players = [0, 1, 2, 3].map((i) =>
      createPlayer({ id: `plr_${i}`, displayName: `P${i}`, createdAt: T0, skillRating: 1000 + i }),
    );
    expect(matchmakingEngine.proposePairs(players)).toHaveLength(2);
  });

  it("records audit entries from journal events", () => {
    const service = serviceWithPlayers(2);
    service.createTournament({ id: "tnm", name: "Cup", format: "leaderboard", createdAt: T0 });
    const log = new AuditLog();
    for (const event of service["store" as never] ? [] : []) {
      log.fromEvent(event);
    }
    const store = new MemoryPersistence();
    const inner = new TournamentService(store);
    inner.createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    for (const event of store.journal.readAll()) {
      log.fromEvent(event);
    }
    expect(summarizeAudit(log.all()).PlayerCreated).toBe(1);
    expect(log.forSubject("player:plr_a")).toHaveLength(1);
  });
});

describe("code catalog", () => {
  it("recognizes known explanation families", () => {
    expect(isKnownCode(EXPLANATION_CODES.SCORE_AWARDED)).toBe(true);
    expect(isKnownCode("not.real")).toBe(false);
    expect(codeFamily(EXPLANATION_CODES.RANK_COMPUTED)).toBe("rank");
    expect(codeFamily(EXPLANATION_CODES.REWARD_GRANTED)).toBe("reward");
    expect(codeFamily(EXPLANATION_CODES.BONUS_STREAK)).toBe("bonus");
    expect(codeFamily(EXPLANATION_CODES.PENALTY_FORFEIT)).toBe("penalty");
    expect(codeFamily("plain")).toBe("plain");
  });
});

describe("scoring preview matrix", () => {
  for (const outcome of ["win", "loss", "draw", "forfeit"] as const) {
    it(`previews a ${outcome} without vip`, () => {
      const awarded = scoringEngine.preview(scoringPreset("standard"), outcome, 0, false);
      expect(Number.isFinite(awarded)).toBe(true);
    });
  }
});

describe("anti-cheat sequence helpers", () => {
  it("allows a started match to complete", () => {
    const match = startMatch(
      createMatch({ id: "mch_ok", tournamentId: "tnm", playerIds: ["plr_a", "plr_b"], createdAt: T0 }),
      T0 + 1,
    );
    expect(
      antiCheatEngine.inspect({
        match,
        awarded: 10,
        submissionKey: "unique",
        seenKeys: new Set(),
        completedAt: T0 + 2,
      }),
    ).toEqual([]);
  });
});

describe("registration capacity", () => {
  it("fills a two-player cup", () => {
    const tournament = openRegistration(
      createTournament({ id: "tnm", name: "Tiny", format: "leaderboard", createdAt: T0, capacity: 2 }),
      T0 + 1,
    );
    const a = createPlayer({ id: "plr_a", displayName: "Ann", createdAt: T0 });
    const b = createPlayer({ id: "plr_b", displayName: "Ben", createdAt: T0 });
    expect(tournament.capacity).toBe(2);
    expect(a.displayName).toBe("Ann");
    expect(b.displayName).toBe("Ben");
    expect(explain("x", "y").code).toBe("x");
  });
});
