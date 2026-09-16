import type {
  MatchRecord,
  PlayerRecord,
  RewardRecord,
  ScoreRecord,
  SeasonRecord,
  TournamentRecord,
} from "../../types.js";
import { scoreMapKey } from "../../domain/scores/score.js";

export interface ArenaState {
  readonly players: ReadonlyMap<string, PlayerRecord>;
  readonly tournaments: ReadonlyMap<string, TournamentRecord>;
  readonly matches: ReadonlyMap<string, MatchRecord>;
  readonly scores: ReadonlyMap<string, ScoreRecord>;
  readonly rewards: ReadonlyMap<string, RewardRecord>;
  readonly seasons: ReadonlyMap<string, SeasonRecord>;
  readonly lastSequence: number;
}

export function emptyArenaState(): ArenaState {
  return {
    players: new Map(),
    tournaments: new Map(),
    matches: new Map(),
    scores: new Map(),
    rewards: new Map(),
    seasons: new Map(),
    lastSequence: 0,
  };
}

export function cloneState(state: ArenaState): ArenaState {
  return {
    players: new Map(state.players),
    tournaments: new Map(state.tournaments),
    matches: new Map(state.matches),
    scores: new Map(state.scores),
    rewards: new Map(state.rewards),
    seasons: new Map(state.seasons),
    lastSequence: state.lastSequence,
  };
}

export function mutableMaps(state: ArenaState): {
  players: Map<string, PlayerRecord>;
  tournaments: Map<string, TournamentRecord>;
  matches: Map<string, MatchRecord>;
  scores: Map<string, ScoreRecord>;
  rewards: Map<string, RewardRecord>;
  seasons: Map<string, SeasonRecord>;
} {
  return {
    players: new Map(state.players),
    tournaments: new Map(state.tournaments),
    matches: new Map(state.matches),
    scores: new Map(state.scores),
    rewards: new Map(state.rewards),
    seasons: new Map(state.seasons),
  };
}

export function scoreKey(tournamentId: string, playerId: string): string {
  return scoreMapKey(playerId, tournamentId);
}

export function serializeState(state: ArenaState): SerializedArenaState {
  return {
    players: [...state.players.values()],
    tournaments: [...state.tournaments.values()],
    matches: [...state.matches.values()],
    scores: [...state.scores.values()],
    rewards: [...state.rewards.values()],
    seasons: [...state.seasons.values()],
    lastSequence: state.lastSequence,
  };
}

export function deserializeState(serialized: SerializedArenaState): ArenaState {
  return {
    players: new Map(serialized.players.map((item) => [item.id, item])),
    tournaments: new Map(serialized.tournaments.map((item) => [item.id, item])),
    matches: new Map(serialized.matches.map((item) => [item.id, item])),
    scores: new Map(
      serialized.scores.map((item) => [scoreKey(item.tournamentId, item.playerId), item]),
    ),
    rewards: new Map(serialized.rewards.map((item) => [item.id, item])),
    seasons: new Map(serialized.seasons.map((item) => [item.id, item])),
    lastSequence: serialized.lastSequence,
  };
}

export interface SerializedArenaState {
  readonly players: readonly PlayerRecord[];
  readonly tournaments: readonly TournamentRecord[];
  readonly matches: readonly MatchRecord[];
  readonly scores: readonly ScoreRecord[];
  readonly rewards: readonly RewardRecord[];
  readonly seasons: readonly SeasonRecord[];
  readonly lastSequence: number;
}
