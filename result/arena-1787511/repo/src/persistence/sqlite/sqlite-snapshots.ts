import { type DatabaseSync } from "node:sqlite";
import { NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import type { SnapshotId } from "../../types.js";
import {
  createSnapshot,
  materializeSnapshot,
  type SnapshotRecord,
  type SnapshotStore,
} from "../../events/snapshots/snapshot.js";
import type { ArenaState } from "../../events/replay/state.js";

export class SqliteSnapshotStore implements SnapshotStore {
  constructor(private readonly db: DatabaseSync) {}

  save(state: ArenaState, at: EpochMillis, id?: SnapshotId): SnapshotRecord {
    const snapshot = createSnapshot(state, at, id);
    this.db
      .prepare("INSERT OR REPLACE INTO snapshots (id, created_at, last_sequence, state) VALUES (?, ?, ?, ?)")
      .run(snapshot.id, snapshot.createdAt, snapshot.lastSequence, JSON.stringify(snapshot.state));
    return snapshot;
  }

  latest(): SnapshotRecord | undefined {
    const row = this.db
      .prepare("SELECT id, created_at, last_sequence, state FROM snapshots ORDER BY last_sequence DESC LIMIT 1")
      .get() as { id: string; created_at: number; last_sequence: number; state: string } | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  get(id: SnapshotId): SnapshotRecord {
    const row = this.db
      .prepare("SELECT id, created_at, last_sequence, state FROM snapshots WHERE id = ?")
      .get(id) as { id: string; created_at: number; last_sequence: number; state: string } | undefined;
    if (!row) {
      throw new NotFoundError("snapshot", id);
    }
    return this.toRecord(row);
  }

  list(): SnapshotRecord[] {
    const rows = this.db
      .prepare("SELECT id, created_at, last_sequence, state FROM snapshots ORDER BY last_sequence ASC")
      .all() as Array<{ id: string; created_at: number; last_sequence: number; state: string }>;
    return rows.map((row) => this.toRecord(row));
  }

  restoreLatest(): ArenaState | undefined {
    const latest = this.latest();
    return latest ? materializeSnapshot(latest) : undefined;
  }

  restore(id: SnapshotId): ArenaState {
    return materializeSnapshot(this.get(id));
  }

  private toRecord(row: { id: string; created_at: number; last_sequence: number; state: string }): SnapshotRecord {
    return {
      id: row.id,
      createdAt: row.created_at,
      lastSequence: row.last_sequence,
      state: JSON.parse(row.state),
    };
  }
}
