import { InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { assertId } from "../../ids.js";
import type {
  MatchId,
  MatchRecord,
  MatchResultRecord,
  MatchStatus,
  PlayerId,
  TeamId,
  TournamentId,
} from "../../types.js";

export interface CreateMatchInput {
  readonly id: MatchId;
  readonly tournamentId: TournamentId;
  readonly playerIds: readonly PlayerId[];
  readonly createdAt: EpochMillis;
  readonly teamIds?: readonly TeamId[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createMatch(input: CreateMatchInput): MatchRecord {
  const id = assertId(input.id, "match.id");
  const tournamentId = assertId(input.tournamentId, "match.tournamentId");
  const playerIds = [...new Set(input.playerIds.map((playerId) => assertId(playerId, "match.playerId")))];
  if (playerIds.length < 2) {
    throw new InvalidArgumentError("a match requires at least two players", { playerIds });
  }
  const createdAt = assertEpochMillis(input.createdAt, "match.createdAt");

  return Object.freeze({
    id,
    tournamentId,
    playerIds: Object.freeze(playerIds),
    teamIds: Object.freeze([...(input.teamIds ?? [])]),
    status: "pending",
    createdAt,
    startedAt: undefined,
    completedAt: undefined,
    results: Object.freeze([]),
    metadata: Object.freeze({ ...(input.metadata ?? {}) }),
  });
}

export function startMatch(match: MatchRecord, at: EpochMillis): MatchRecord {
  assertEpochMillis(at, "startMatch.at");
  if (match.status !== "pending") {
    throw new InvalidArgumentError("only pending matches can be started", {
      matchId: match.id,
      status: match.status,
    });
  }
  return Object.freeze({
    ...match,
    status: "started" satisfies MatchStatus,
    startedAt: at,
  });
}

export function completeMatch(
  match: MatchRecord,
  results: readonly MatchResultRecord[],
  at: EpochMillis,
): MatchRecord {
  assertEpochMillis(at, "completeMatch.at");
  if (match.status !== "started") {
    throw new InvalidArgumentError("only started matches can be completed", {
      matchId: match.id,
      status: match.status,
    });
  }
  assertResultsCoverPlayers(match, results);
  return Object.freeze({
    ...match,
    status: "completed" satisfies MatchStatus,
    completedAt: at,
    results: Object.freeze(results.map((result) => Object.freeze({ ...result }))),
  });
}

/**
 * Attach one participant's result to a match that is still running. Results
 * arrive one at a time, and a match holds them until it is completed, so a
 * rebuild later on can read what each player actually did.
 */
export function withResult(match: MatchRecord, result: MatchResultRecord): MatchRecord {
  if (match.status === "completed" || match.status === "voided") {
    throw new InvalidArgumentError("a settled match takes no further results", {
      matchId: match.id,
      status: match.status,
    });
  }
  const others = match.results.filter((existing) => existing.playerId !== result.playerId);
  return Object.freeze({
    ...match,
    results: Object.freeze([...others, Object.freeze({ ...result })]),
  });
}

export function voidMatch(match: MatchRecord, at: EpochMillis): MatchRecord {
  assertEpochMillis(at, "voidMatch.at");
  if (match.status === "voided") {
    throw new InvalidArgumentError("match is already voided", { matchId: match.id });
  }
  return Object.freeze({
    ...match,
    status: "voided" satisfies MatchStatus,
    completedAt: at,
  });
}

export function includesPlayer(match: MatchRecord, playerId: PlayerId): boolean {
  return match.playerIds.includes(playerId);
}

function assertResultsCoverPlayers(match: MatchRecord, results: readonly MatchResultRecord[]): void {
  const resultPlayers = new Set(results.map((result) => result.playerId));
  for (const playerId of match.playerIds) {
    if (!resultPlayers.has(playerId)) {
      throw new InvalidArgumentError("match results missing player", {
        matchId: match.id,
        playerId,
      });
    }
  }
  if (resultPlayers.size !== match.playerIds.length) {
    throw new InvalidArgumentError("match results include unknown players", {
      matchId: match.id,
      resultPlayers: [...resultPlayers],
    });
  }
}
