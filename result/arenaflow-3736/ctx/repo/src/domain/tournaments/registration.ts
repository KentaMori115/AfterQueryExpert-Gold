import { ConflictError, IllegalStateError } from "../../errors.js";
import type { PlayerId, PlayerRecord, TournamentRecord } from "../../types.js";
import { isFull, isRegistered, withRegisteredPlayers } from "./tournament.js";
import { isAcceptingRegistrations } from "./lifecycle.js";

export function registerPlayer(
  tournament: TournamentRecord,
  player: PlayerRecord,
): TournamentRecord {
  if (!isAcceptingRegistrations(tournament)) {
    throw new IllegalStateError("tournament is not accepting registrations", {
      tournamentId: tournament.id,
      status: tournament.status,
    });
  }
  if (isRegistered(tournament, player.id)) {
    throw new ConflictError(`player already registered: ${player.id}`, {
      tournamentId: tournament.id,
      playerId: player.id,
    });
  }
  if (isFull(tournament)) {
    throw new IllegalStateError("tournament is full", {
      tournamentId: tournament.id,
      capacity: tournament.capacity,
    });
  }
  return withRegisteredPlayers(tournament, [...tournament.registeredPlayerIds, player.id]);
}

export function unregisterPlayer(tournament: TournamentRecord, playerId: PlayerId): TournamentRecord {
  if (!isAcceptingRegistrations(tournament)) {
    throw new IllegalStateError("cannot unregister after registration closes", {
      tournamentId: tournament.id,
      status: tournament.status,
    });
  }
  if (!isRegistered(tournament, playerId)) {
    throw new IllegalStateError("player is not registered", {
      tournamentId: tournament.id,
      playerId,
    });
  }
  return withRegisteredPlayers(
    tournament,
    tournament.registeredPlayerIds.filter((id) => id !== playerId),
  );
}

export function registeredCount(tournament: TournamentRecord): number {
  return tournament.registeredPlayerIds.length;
}
