import { describe, expect, it } from "vitest";
import { InvalidArgumentError } from "../../src/errors.js";
import {
  completeMatch,
  createMatch,
  drawResult,
  pairResult,
  placementResults,
  startMatch,
  voidMatch,
  winners,
} from "../../src/domain/matches/index.js";

const T0 = 1_700_000_200_000;

describe("match domain", () => {
  it("creates a pending match and completes a pair result", () => {
    let match = createMatch({
      id: "mch_1",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0,
    });
    match = startMatch(match, T0 + 1);
    match = completeMatch(match, pairResult({ winnerId: "plr_a", loserId: "plr_b" }), T0 + 2);
    expect(match.status).toBe("completed");
    expect(winners(match)).toEqual(["plr_a"]);
    expect(match.completedAt).toBe(T0 + 2);
  });

  it("rejects matches with fewer than two unique players", () => {
    expect(() =>
      createMatch({
        id: "mch_bad",
        tournamentId: "tnm_cup",
        playerIds: ["plr_a", "plr_a"],
        createdAt: T0,
      }),
    ).toThrow(InvalidArgumentError);
  });

  it("cannot complete a match that has not started", () => {
    const match = createMatch({
      id: "mch_2",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b"],
      createdAt: T0,
    });
    expect(() => completeMatch(match, pairResult({ winnerId: "plr_a", loserId: "plr_b" }), T0 + 1)).toThrow(
      InvalidArgumentError,
    );
  });

  it("supports draws, placements, and voiding", () => {
    let match = createMatch({
      id: "mch_3",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b", "plr_c"],
      createdAt: T0,
    });
    match = startMatch(match, T0 + 1);
    const drawn = completeMatch(match, drawResult(["plr_a", "plr_b", "plr_c"]), T0 + 2);
    expect(drawn.results.every((result) => result.outcome === "draw")).toBe(true);

    let placed = createMatch({
      id: "mch_4",
      tournamentId: "tnm_cup",
      playerIds: ["plr_a", "plr_b", "plr_c"],
      createdAt: T0,
    });
    placed = startMatch(placed, T0 + 1);
    placed = completeMatch(
      placed,
      placementResults([
        { playerId: "plr_c", rawScore: 30, placement: 1 },
        { playerId: "plr_a", rawScore: 20, placement: 2 },
        { playerId: "plr_b", rawScore: 10, placement: 3 },
      ]),
      T0 + 2,
    );
    expect(winners(placed)).toEqual(["plr_c"]);

    const voided = voidMatch(startMatch(
      createMatch({
        id: "mch_5",
        tournamentId: "tnm_cup",
        playerIds: ["plr_a", "plr_b"],
        createdAt: T0,
      }),
      T0 + 1,
    ), T0 + 2);
    expect(voided.status).toBe("voided");
  });
});
