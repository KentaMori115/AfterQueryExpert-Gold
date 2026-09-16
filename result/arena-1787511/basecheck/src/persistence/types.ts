import type { EpochMillis } from "../clock.js";
import type {
  MatchRecord,
  PlayerRecord,
  RewardRecord,
  ScoreRecord,
  SeasonRecord,
  TournamentRecord,
} from "../types.js";
import type { DomainEvent } from "../events/types.js";
import type { EventJournal } from "../events/journal/journal.js";
import type { ArenaState } from "../events/replay/state.js";
import type { SnapshotRecord, SnapshotStore } from "../events/snapshots/snapshot.js";

export interface PersistenceAdapter {
  readonly kind: "memory" | "sqlite";
  readonly journal: EventJournal;
  readonly snapshots: SnapshotStore;
  load(): ArenaState;
  savePlayer(player: PlayerRecord): void;
  saveTournament(tournament: TournamentRecord): void;
  saveMatch(match: MatchRecord): void;
  saveScore(score: ScoreRecord): void;
  saveReward(reward: RewardRecord): void;
  saveSeason(season: SeasonRecord): void;
  getPlayer(id: string): PlayerRecord | undefined;
  getTournament(id: string): TournamentRecord | undefined;
  getMatch(id: string): MatchRecord | undefined;
  getReward(id: string): RewardRecord | undefined;
  getSeason(id: string): SeasonRecord | undefined;
  listPlayers(): PlayerRecord[];
  listTournaments(): TournamentRecord[];
  listMatches(tournamentId?: string): MatchRecord[];
  listScores(tournamentId: string): ScoreRecord[];
  listRewards(playerId?: string): RewardRecord[];
  listSeasons(): SeasonRecord[];
  replaceState(state: ArenaState): void;
  appendEvent(event: DomainEvent): void;
  checkpoint(at: EpochMillis): SnapshotRecord;
  close(): void;
}
