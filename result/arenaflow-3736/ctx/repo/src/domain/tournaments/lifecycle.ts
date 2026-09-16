import { IllegalStateError } from "../../errors.js";
import { type EpochMillis, assertEpochMillis } from "../../clock.js";
import { explain } from "../../explain.js";
import type { TournamentRecord, TournamentStatus } from "../../types.js";
import { withStatus } from "./tournament.js";

const TRANSITIONS: Readonly<Record<TournamentStatus, readonly TournamentStatus[]>> = {
  draft: ["registration", "cancelled"],
  registration: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: TournamentStatus, to: TournamentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TournamentStatus, to: TournamentStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalStateError(`cannot transition tournament from ${from} to ${to}`, { from, to });
  }
}

export function openRegistration(tournament: TournamentRecord, at: EpochMillis): TournamentRecord {
  assertEpochMillis(at, "openRegistration.at");
  assertTransition(tournament.status, "registration");
  return withStatus(tournament, "registration", at);
}

export function startTournament(tournament: TournamentRecord, at: EpochMillis): TournamentRecord {
  assertEpochMillis(at, "startTournament.at");
  assertTransition(tournament.status, "active");
  if (tournament.registeredPlayerIds.length < 2) {
    throw new IllegalStateError("cannot start a tournament with fewer than two players", {
      tournamentId: tournament.id,
      registered: tournament.registeredPlayerIds.length,
    });
  }
  return withStatus(tournament, "active", at);
}

export function endTournament(tournament: TournamentRecord, at: EpochMillis): TournamentRecord {
  assertEpochMillis(at, "endTournament.at");
  assertTransition(tournament.status, "completed");
  return withStatus(tournament, "completed", at);
}

export function cancelTournament(tournament: TournamentRecord, at: EpochMillis): TournamentRecord {
  assertEpochMillis(at, "cancelTournament.at");
  assertTransition(tournament.status, "cancelled");
  return withStatus(tournament, "cancelled", at);
}

export function lifecycleExplanation(
  tournament: TournamentRecord,
  action: "open" | "start" | "end" | "cancel",
): ReturnType<typeof explain> {
  return explain(`tournament.${action}`, `${action} tournament ${tournament.id}`, {
    id: tournament.id,
    status: tournament.status,
    format: tournament.format,
    registered: tournament.registeredPlayerIds.length,
  });
}

export function isAcceptingRegistrations(tournament: TournamentRecord): boolean {
  return tournament.status === "registration";
}

export function isAcceptingMatches(tournament: TournamentRecord): boolean {
  return tournament.status === "active";
}

export function isTerminal(tournament: TournamentRecord): boolean {
  return tournament.status === "completed" || tournament.status === "cancelled";
}
