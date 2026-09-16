import { NotFoundError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { createPrefixedId } from "../../ids.js";
import type { SnapshotId } from "../../types.js";
import {
  deserializeState,
  serializeState,
  type ArenaState,
  type SerializedArenaState,
} from "../replay/state.js";

export interface SnapshotRecord {
  readonly id: SnapshotId;
  readonly createdAt: EpochMillis;
  readonly lastSequence: number;
  readonly state: SerializedArenaState;
}

export interface SnapshotStore {
  save(state: ArenaState, at: EpochMillis, id?: SnapshotId): SnapshotRecord;
  latest(): SnapshotRecord | undefined;
  get(id: SnapshotId): SnapshotRecord;
  list(): SnapshotRecord[];
  restoreLatest(): ArenaState | undefined;
  restore(id: SnapshotId): ArenaState;
}

export function createSnapshot(state: ArenaState, at: EpochMillis, id?: SnapshotId): SnapshotRecord {
  assertEpochMillis(at, "snapshot.createdAt");
  return Object.freeze({
    id: id ?? createPrefixedId("snp", `seq_${state.lastSequence}`),
    createdAt: at,
    lastSequence: state.lastSequence,
    state: serializeState(state),
  });
}

export function materializeSnapshot(snapshot: SnapshotRecord): ArenaState {
  return deserializeState(snapshot.state);
}

export class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<SnapshotId, SnapshotRecord>();

  save(state: ArenaState, at: EpochMillis, id?: SnapshotId): SnapshotRecord {
    const snapshot = createSnapshot(state, at, id);
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  latest(): SnapshotRecord | undefined {
    return [...this.snapshots.values()].sort((a, b) => b.lastSequence - a.lastSequence)[0];
  }

  get(id: SnapshotId): SnapshotRecord {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) {
      throw new NotFoundError("snapshot", id);
    }
    return snapshot;
  }

  list(): SnapshotRecord[] {
    return [...this.snapshots.values()].sort((a, b) => a.lastSequence - b.lastSequence);
  }

  restoreLatest(): ArenaState | undefined {
    const latest = this.latest();
    return latest ? materializeSnapshot(latest) : undefined;
  }

  restore(id: SnapshotId): ArenaState {
    return materializeSnapshot(this.get(id));
  }
}
