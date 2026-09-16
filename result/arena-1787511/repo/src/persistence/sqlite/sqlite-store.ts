import { DatabaseSync } from "node:sqlite";
import type { EpochMillis } from "../../clock.js";
import type {
  MatchRecord,
  PlayerRecord,
  RewardRecord,
  ScoreRecord,
  SeasonRecord,
  TournamentRecord,
} from "../../types.js";
import { replayJournal } from "../../events/replay/replay.js";
import { emptyArenaState, scoreKey, type ArenaState } from "../../events/replay/state.js";
import type { SnapshotRecord } from "../../events/snapshots/snapshot.js";
import type { DomainEvent } from "../../events/types.js";
import type { PersistenceAdapter } from "../types.js";
import { SQLITE_SCHEMA } from "./schema.js";
import { SqliteEventJournal } from "./sqlite-journal.js";
import { SqliteSnapshotStore } from "./sqlite-snapshots.js";

export class SqlitePersistence implements PersistenceAdapter {
  readonly kind = "sqlite" as const;
  readonly journal: SqliteEventJournal;
  readonly snapshots: SqliteSnapshotStore;
  private readonly db: DatabaseSync;

  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec(SQLITE_SCHEMA);
    this.journal = new SqliteEventJournal(this.db);
    this.snapshots = new SqliteSnapshotStore(this.db);
  }

  load(): ArenaState {
    const snapshot = this.snapshots.restoreLatest();
    const state = replayJournal(this.journal, snapshot ? { fromState: snapshot } : {});
    this.replaceState(state);
    return state;
  }

  savePlayer(player: PlayerRecord): void {
    this.upsert("players", player.id, player);
  }

  saveTournament(tournament: TournamentRecord): void {
    this.upsert("tournaments", tournament.id, tournament);
  }

  saveMatch(match: MatchRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO matches (id, tournament_id, document) VALUES (?, ?, ?)")
      .run(match.id, match.tournamentId, JSON.stringify(match));
  }

  saveScore(score: ScoreRecord): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO scores (score_key, tournament_id, player_id, document) VALUES (?, ?, ?, ?)",
      )
      .run(scoreKey(score.tournamentId, score.playerId), score.tournamentId, score.playerId, JSON.stringify(score));
  }

  saveReward(reward: RewardRecord): void {
    this.db
      .prepare("INSERT OR REPLACE INTO rewards (id, player_id, document) VALUES (?, ?, ?)")
      .run(reward.id, reward.playerId, JSON.stringify(reward));
  }

  saveSeason(season: SeasonRecord): void {
    this.upsert("seasons", season.id, season);
  }

  getPlayer(id: string): PlayerRecord | undefined {
    return this.getDocument("players", id);
  }

  getTournament(id: string): TournamentRecord | undefined {
    return this.getDocument("tournaments", id);
  }

  getMatch(id: string): MatchRecord | undefined {
    return this.getDocument("matches", id);
  }

  getReward(id: string): RewardRecord | undefined {
    return this.getDocument("rewards", id);
  }

  getSeason(id: string): SeasonRecord | undefined {
    return this.getDocument("seasons", id);
  }

  listPlayers(): PlayerRecord[] {
    return this.listDocuments("players");
  }

  listTournaments(): TournamentRecord[] {
    return this.listDocuments("tournaments");
  }

  listMatches(tournamentId?: string): MatchRecord[] {
    const rows = tournamentId
      ? this.db.prepare("SELECT document FROM matches WHERE tournament_id = ? ORDER BY id").all(tournamentId)
      : this.db.prepare("SELECT document FROM matches ORDER BY id").all();
    return (rows as Array<{ document: string }>).map((row) => JSON.parse(row.document) as MatchRecord);
  }

  listScores(tournamentId: string): ScoreRecord[] {
    const rows = this.db
      .prepare("SELECT document FROM scores WHERE tournament_id = ? ORDER BY player_id")
      .all(tournamentId) as Array<{ document: string }>;
    return rows.map((row) => JSON.parse(row.document) as ScoreRecord);
  }

  listRewards(playerId?: string): RewardRecord[] {
    const rows = playerId
      ? this.db.prepare("SELECT document FROM rewards WHERE player_id = ? ORDER BY id").all(playerId)
      : this.db.prepare("SELECT document FROM rewards ORDER BY id").all();
    return (rows as Array<{ document: string }>).map((row) => JSON.parse(row.document) as RewardRecord);
  }

  listSeasons(): SeasonRecord[] {
    return this.listDocuments("seasons");
  }

  replaceState(state: ArenaState): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM players");
      this.db.exec("DELETE FROM tournaments");
      this.db.exec("DELETE FROM matches");
      this.db.exec("DELETE FROM scores");
      this.db.exec("DELETE FROM rewards");
      this.db.exec("DELETE FROM seasons");
      for (const player of state.players.values()) {
        this.savePlayer(player);
      }
      for (const tournament of state.tournaments.values()) {
        this.saveTournament(tournament);
      }
      for (const match of state.matches.values()) {
        this.saveMatch(match);
      }
      for (const score of state.scores.values()) {
        this.saveScore(score);
      }
      for (const reward of state.rewards.values()) {
        this.saveReward(reward);
      }
      for (const season of state.seasons.values()) {
        this.saveSeason(season);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendEvent(event: DomainEvent): void {
    this.journal.append({
      type: event.type,
      at: event.at,
      streamId: event.streamId,
      payload: event.payload,
      explanation: event.explanation,
      id: event.id,
    } as never);
  }

  checkpoint(at: EpochMillis): SnapshotRecord {
    const snapshot = this.snapshots.restoreLatest();
    const state = replayJournal(this.journal, snapshot ? { fromState: snapshot } : {});
    return this.snapshots.save(state, at);
  }

  close(): void {
    this.db.close();
  }

  private upsert(table: string, id: string, document: unknown): void {
    this.db.prepare(`INSERT OR REPLACE INTO ${table} (id, document) VALUES (?, ?)`).run(id, JSON.stringify(document));
  }

  private getDocument<T>(table: string, id: string): T | undefined {
    const row = this.db.prepare(`SELECT document FROM ${table} WHERE id = ?`).get(id) as
      | { document: string }
      | undefined;
    return row ? (JSON.parse(row.document) as T) : undefined;
  }

  private listDocuments<T>(table: string): T[] {
    const rows = this.db.prepare(`SELECT document FROM ${table} ORDER BY id`).all() as Array<{ document: string }>;
    return rows.map((row) => JSON.parse(row.document) as T);
  }
}

export function emptySqliteState(): ArenaState {
  return emptyArenaState();
}
