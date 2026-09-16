import { ReplayError } from "../../errors.js";
import type { MatchRecord, TournamentRecord } from "../../types.js";
import { createPlayer } from "../../domain/players/player.js";
import {
  cancelTournament,
  createTournament,
  endTournament,
  openRegistration,
  startTournament,
  withRegisteredPlayers,
} from "../../domain/tournaments/index.js";
import { completeMatch, createMatch, startMatch, voidMatch } from "../../domain/matches/match.js";
import { applyScoreDelta, emptyScore } from "../../domain/scores/score.js";
import { claimReward, grantReward, revokeReward } from "../../domain/rewards/reward.js";
import { activateSeason, closeSeason, createSeason } from "../../domain/seasons/season.js";
import type { DomainEvent } from "../types.js";
import { mutableMaps, scoreKey, type ArenaState } from "./state.js";

export function projectEvent(state: ArenaState, event: DomainEvent): ArenaState {
  if (event.sequence !== state.lastSequence + 1) {
    throw new ReplayError("event sequence does not follow state", {
      expected: state.lastSequence + 1,
      received: event.sequence,
      id: event.id,
    });
  }
  const maps = mutableMaps(state);
  switch (event.type) {
    case "PlayerCreated": {
      const player = createPlayer({
        id: event.payload.playerId,
        displayName: event.payload.displayName,
        createdAt: event.at,
        skillRating: event.payload.skillRating,
        level: event.payload.level,
        vip: event.payload.vip,
      });
      maps.players.set(player.id, player);
      break;
    }
    case "TournamentCreated": {
      const tournament = createTournament({
        id: event.payload.tournamentId,
        name: event.payload.name,
        format: event.payload.format,
        createdAt: event.at,
        ...(event.payload.seasonId ? { seasonId: event.payload.seasonId } : {}),
      });
      maps.tournaments.set(tournament.id, tournament);
      break;
    }
    case "TournamentOpened": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(current.id, openRegistration(current, event.at));
      break;
    }
    case "PlayerRegistered": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(
        current.id,
        withRegisteredPlayers(current, [...current.registeredPlayerIds, event.payload.playerId]),
      );
      break;
    }
    case "PlayerUnregistered": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(
        current.id,
        withRegisteredPlayers(
          current,
          current.registeredPlayerIds.filter((id) => id !== event.payload.playerId),
        ),
      );
      break;
    }
    case "TournamentStarted": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(current.id, startTournament(current, event.at));
      break;
    }
    case "TournamentEnded": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(current.id, endTournament(current, event.at));
      break;
    }
    case "TournamentCancelled": {
      const current = requireTournament(maps.tournaments, event.payload.tournamentId);
      maps.tournaments.set(current.id, cancelTournament(current, event.at));
      break;
    }
    case "MatchCreated": {
      const match = createMatch({
        id: event.payload.matchId,
        tournamentId: event.payload.tournamentId,
        playerIds: event.payload.playerIds,
        createdAt: event.at,
      });
      maps.matches.set(match.id, match);
      break;
    }
    case "MatchStarted": {
      const current = requireMatch(maps.matches, event.payload.matchId);
      maps.matches.set(current.id, startMatch(current, event.at));
      break;
    }
    case "ScoreSubmitted": {
      const key = scoreKey(event.payload.tournamentId, event.payload.playerId);
      const current = maps.scores.get(key) ?? emptyScore(event.payload.playerId, event.payload.tournamentId, event.at);
      maps.scores.set(
        key,
        applyScoreDelta(
          current,
          event.payload.awarded,
          event.at,
          event.explanation,
          event.payload.outcome,
        ),
      );
      break;
    }
    case "MatchCompleted": {
      const current = requireMatch(maps.matches, event.payload.matchId);
      if (current.status === "started") {
        const results = current.playerIds.map((playerId) => ({
          playerId,
          outcome: "draw" as const,
          rawScore: 0,
          placement: 1 as number | undefined,
        }));
        maps.matches.set(current.id, completeMatch(current, results, event.at));
      }
      break;
    }
    case "MatchVoided": {
      const current = requireMatch(maps.matches, event.payload.matchId);
      maps.matches.set(current.id, voidMatch(current, event.at));
      break;
    }
    case "PenaltyApplied": {
      const key = scoreKey(event.payload.tournamentId, event.payload.playerId);
      const current = maps.scores.get(key) ?? emptyScore(event.payload.playerId, event.payload.tournamentId, event.at);
      maps.scores.set(
        key,
        applyScoreDelta(current, -Math.abs(event.payload.amount), event.at, event.explanation),
      );
      break;
    }
    case "RewardGranted": {
      maps.rewards.set(
        event.payload.rewardId,
        grantReward({
          id: event.payload.rewardId,
          playerId: event.payload.playerId,
          tournamentId: event.payload.tournamentId,
          amount: event.payload.amount,
          tier: event.payload.tier,
          grantedAt: event.at,
          explanation: event.explanation,
        }),
      );
      break;
    }
    case "RewardClaimed": {
      const current = maps.rewards.get(event.payload.rewardId);
      if (current) {
        maps.rewards.set(current.id, claimReward(current, event.at));
      }
      break;
    }
    case "RewardRevoked": {
      const current = maps.rewards.get(event.payload.rewardId);
      if (current) {
        maps.rewards.set(current.id, revokeReward(current, event.payload.reason));
      }
      break;
    }
    case "SeasonOpened": {
      const existing = maps.seasons.get(event.payload.seasonId);
      if (existing) {
        maps.seasons.set(existing.id, activateSeason(existing, event.at));
      } else {
        const created = createSeason({
          id: event.payload.seasonId,
          name: event.payload.seasonId,
          createdAt: event.at,
          startsAt: event.at,
          endsAt: event.at + 1,
        });
        maps.seasons.set(created.id, activateSeason(created, event.at));
      }
      break;
    }
    case "SeasonClosed": {
      const existing = maps.seasons.get(event.payload.seasonId);
      if (existing) {
        maps.seasons.set(existing.id, closeSeason(existing, event.at));
      }
      break;
    }
    case "SnapshotTaken":
    case "AntiCheatFlagged":
      break;
    default: {
      const _never: never = event;
      throw new ReplayError("unknown event type during replay", { event: _never });
    }
  }
  return {
    ...maps,
    lastSequence: event.sequence,
  };
}

function requireTournament(tournaments: Map<string, TournamentRecord>, id: string) {
  const tournament = tournaments.get(id);
  if (!tournament) {
    throw new ReplayError("tournament missing during replay", { id });
  }
  return tournament;
}

function requireMatch(matches: Map<string, MatchRecord>, id: string) {
  const match = matches.get(id);
  if (!match) {
    throw new ReplayError("match missing during replay", { id });
  }
  return match;
}
