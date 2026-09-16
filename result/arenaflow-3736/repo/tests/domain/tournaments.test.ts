import { describe, expect, it } from "vitest";
import { ConflictError, IllegalStateError, InvalidArgumentError } from "../../src/errors.js";
import { createPlayer } from "../../src/domain/players/index.js";
import {
  cancelTournament,
  createTournament,
  endTournament,
  isAcceptingMatches,
  openRegistration,
  registerPlayer,
  remainingSlots,
  startTournament,
  unregisterPlayer,
} from "../../src/domain/tournaments/index.js";

const T0 = 1_700_000_100_000;

function draft() {
  return createTournament({
    id: "tnm_cup",
    name: "Summer Cup",
    format: "leaderboard",
    createdAt: T0,
    capacity: 4,
  });
}

describe("tournament domain", () => {
  it("creates a draft tournament with default scoring", () => {
    const tournament = draft();
    expect(tournament.status).toBe("draft");
    expect(tournament.scoring.winPoints).toBe(100);
    expect(tournament.scoring.lossPoints).toBe(-20);
    expect(Object.isFrozen(tournament)).toBe(true);
  });

  it("rejects unsupported formats and tiny names", () => {
    expect(() =>
      createTournament({
        id: "tnm_x",
        name: "X",
        format: "leaderboard",
        createdAt: T0,
      }),
    ).toThrow(InvalidArgumentError);
  });

  it("opens registration, registers unique players, and starts", () => {
    const a = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    const b = createPlayer({ id: "plr_b", displayName: "B", createdAt: T0 });
    let tournament = openRegistration(draft(), T0 + 1);
    tournament = registerPlayer(tournament, a);
    tournament = registerPlayer(tournament, b);
    expect(remainingSlots(tournament)).toBe(2);
    expect(() => registerPlayer(tournament, a)).toThrow(ConflictError);
    tournament = startTournament(tournament, T0 + 2);
    expect(tournament.status).toBe("active");
    expect(isAcceptingMatches(tournament)).toBe(true);
    expect(tournament.startedAt).toBe(T0 + 2);
  });

  it("cannot start with fewer than two players", () => {
    const tournament = openRegistration(draft(), T0 + 1);
    expect(() => startTournament(tournament, T0 + 2)).toThrow(IllegalStateError);
  });

  it("unregisters during registration only", () => {
    const a = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    const b = createPlayer({ id: "plr_b", displayName: "B", createdAt: T0 });
    let tournament = openRegistration(draft(), T0 + 1);
    tournament = registerPlayer(tournament, a);
    tournament = registerPlayer(tournament, b);
    tournament = unregisterPlayer(tournament, a.id);
    expect(tournament.registeredPlayerIds).toEqual(["plr_b"]);
    tournament = registerPlayer(tournament, a);
    tournament = startTournament(tournament, T0 + 2);
    expect(() => unregisterPlayer(tournament, a.id)).toThrow(IllegalStateError);
  });

  it("ends and cancels through legal transitions", () => {
    const a = createPlayer({ id: "plr_a", displayName: "A", createdAt: T0 });
    const b = createPlayer({ id: "plr_b", displayName: "B", createdAt: T0 });
    let tournament = openRegistration(draft(), T0 + 1);
    tournament = registerPlayer(tournament, a);
    tournament = registerPlayer(tournament, b);
    tournament = startTournament(tournament, T0 + 2);
    tournament = endTournament(tournament, T0 + 3);
    expect(tournament.status).toBe("completed");
    expect(() => cancelTournament(tournament, T0 + 4)).toThrow(IllegalStateError);

    let cancelled = openRegistration(draft(), T0 + 1);
    cancelled = cancelTournament(cancelled, T0 + 2);
    expect(cancelled.status).toBe("cancelled");
  });
});
