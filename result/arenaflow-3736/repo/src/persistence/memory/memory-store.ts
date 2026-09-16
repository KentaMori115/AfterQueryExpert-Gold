import { NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import type {
  MatchRecord,
  PlayerRecord,
  RewardRecord,
  ScoreRecord,
  SeasonRecord,
  TournamentRecord,
} from "../../types.js";
import { MemoryEventJournal } from "../../events/journal/memory-journal.js";
import { MemorySnapshotStore } from "../../events/snapshots/snapshot.js";
import { replayJournal } from "../../events/replay/replay.js";
import { emptyArenaState, scoreKey, type ArenaState } from "../../events/replay/state.js";
import type { DomainEvent } from "../../events/types.js";
import type { PersistenceAdapter } from "../types.js";

export class MemoryPersistence implements PersistenceAdapter {
  readonly kind = "memory" as const;
  readonly journal = new MemoryEventJournal();
  readonly snapshots = new MemorySnapshotStore();

  private state: ArenaState = emptyArenaState();

  load(): ArenaState {
    const snapshot = this.snapshots.restoreLatest();
    this.state = replayJournal(this.journal, snapshot ? { fromState: snapshot } : {});
    return this.state;
  }

  savePlayer(player: PlayerRecord): void {
    const players = new Map(this.state.players);
    players.set(player.id, player);
    this.state = { ...this.state, players };
  }

  saveTournament(tournament: TournamentRecord): void {
    const tournaments = new Map(this.state.tournaments);
    tournaments.set(tournament.id, tournament);
    this.state = { ...this.state, tournaments };
  }

  saveMatch(match: MatchRecord): void {
    const matches = new Map(this.state.matches);
    matches.set(match.id, match);
    this.state = { ...this.state, matches };
  }

  saveScore(score: ScoreRecord): void {
    const scores = new Map(this.state.scores);
    scores.set(scoreKey(score.tournamentId, score.playerId), score);
    this.state = { ...this.state, scores };
  }

  saveReward(reward: RewardRecord): void {
    const rewards = new Map(this.state.rewards);
    rewards.set(reward.id, reward);
    this.state = { ...this.state, rewards };
  }

  saveSeason(season: SeasonRecord): void {
    const seasons = new Map(this.state.seasons);
    seasons.set(season.id, season);
    this.state = { ...this.state, seasons };
  }

  getPlayer(id: string): PlayerRecord | undefined {
    return this.state.players.get(id);
  }

  requirePlayer(id: string): PlayerRecord {
    const player = this.getPlayer(id);
    if (!player) {
      throw new NotFoundError("player", id);
    }
    return player;
  }

  getTournament(id: string): TournamentRecord | undefined {
    return this.state.tournaments.get(id);
  }

  requireTournament(id: string): TournamentRecord {
    const tournament = this.getTournament(id);
    if (!tournament) {
      throw new NotFoundError("tournament", id);
    }
    return tournament;
  }

  getMatch(id: string): MatchRecord | undefined {
    return this.state.matches.get(id);
  }

  getReward(id: string): RewardRecord | undefined {
    return this.state.rewards.get(id);
  }

  getSeason(id: string): SeasonRecord | undefined {
    return this.state.seasons.get(id);
  }

  listPlayers(): PlayerRecord[] {
    return [...this.state.players.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  listTournaments(): TournamentRecord[] {
    return [...this.state.tournaments.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  listMatches(tournamentId?: string): MatchRecord[] {
    const matches = [...this.state.matches.values()];
    const filtered = tournamentId ? matches.filter((match) => match.tournamentId === tournamentId) : matches;
    return filtered.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  listScores(tournamentId: string): ScoreRecord[] {
    return [...this.state.scores.values()]
      .filter((score) => score.tournamentId === tournamentId)
      .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  }

  listRewards(playerId?: string): RewardRecord[] {
    const rewards = [...this.state.rewards.values()];
    const filtered = playerId ? rewards.filter((reward) => reward.playerId === playerId) : rewards;
    return filtered.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  listSeasons(): SeasonRecord[] {
    return [...this.state.seasons.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  replaceState(state: ArenaState): void {
    this.state = state;
  }

  appendEvent(event: DomainEvent): void {
    this.journal.restore([...this.journal.readAll(), event]);
  }

  checkpoint(at: EpochMillis) {
    return this.snapshots.save(this.state, at);
  }

  current(): ArenaState {
    return this.state;
  }

  close(): void {
    // Memory adapter has no external resources.
  }
}
