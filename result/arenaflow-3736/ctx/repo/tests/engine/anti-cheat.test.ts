import { describe, expect, it } from "vitest";
import { AntiCheatError } from "../../src/errors.js";
import { createMatch, startMatch } from "../../src/domain/matches/index.js";
import { antiCheatEngine } from "../../src/engine/anti-cheat/index.js";

const T0 = 1_700_001_500_000;

describe("anti-cheat engine", () => {
  it("blocks impossible scores, duplicates, and invalid sequences", () => {
    const pending = createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0,
    });
    const started = startMatch(pending, T0 + 1);
    const key = antiCheatEngine.submissionKey("mch_1", "plr_a", 1, "win");
    expect(() =>
      antiCheatEngine.assertClean({
        match: started,
        awarded: 9999,
        submissionKey: key,
        seenKeys: new Set(),
      }),
    ).toThrow(AntiCheatError);
    expect(() =>
      antiCheatEngine.assertClean({
        match: started,
        awarded: 100,
        submissionKey: key,
        seenKeys: new Set([key]),
      }),
    ).toThrow(AntiCheatError);
    expect(() =>
      antiCheatEngine.assertClean({
        match: pending,
        awarded: 100,
        submissionKey: "other",
        seenKeys: new Set(),
      }),
    ).toThrow(AntiCheatError);
  });

  it("warns on abnormal win rates without blocking", () => {
    const match = startMatch(
      createMatch({
        id: "mch_2",
        tournamentId: "tnm_cup",
        playerIds: ["plr_a", "plr_b"],
        createdAt: T0,
      }),
      T0 + 1,
    );
    const findings = antiCheatEngine.assertClean({
      match,
      awarded: 100,
      submissionKey: "fresh",
      seenKeys: new Set(),
      wins: 20,
      matchesPlayed: 20,
    });
    expect(findings.some((finding) => finding.code === "abnormal_behavior")).toBe(true);
  });

  it("blocks duplicate event ids and zero-time completions", () => {
    const match = startMatch(
      createMatch({
        id: "mch_3",
        tournamentId: "tnm_cup",
        playerIds: ["plr_a", "plr_b"],
        createdAt: T0,
      }),
      T0 + 5,
    );
    expect(() =>
      antiCheatEngine.assertClean({
        match,
        awarded: 10,
        submissionKey: "fresh-2",
        seenKeys: new Set(),
        completedAt: T0 + 5,
      }),
    ).toThrow(AntiCheatError);
    expect(() =>
      antiCheatEngine.assertClean({
        match,
        awarded: 10,
        submissionKey: "fresh-3",
        seenKeys: new Set(),
        completedAt: T0 + 6,
        eventId: "evt_1",
        seenEventIds: new Set(["evt_1"]),
      }),
    ).toThrow(AntiCheatError);
  });
});
