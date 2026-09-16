import { type DatabaseSync } from "node:sqlite";
import { ConflictError } from "../../errors.js";
import type { DomainEvent, DomainEventType } from "../../events/types.js";
import { makeEvent, type AppendEventInput, type EventJournal } from "../../events/journal/journal.js";

export class SqliteEventJournal implements EventJournal {
  constructor(private readonly db: DatabaseSync) {}

  append<T extends DomainEventType>(input: AppendEventInput<T>): DomainEvent {
    const sequence = this.lastSequence() + 1;
    const event = makeEvent(input, sequence);
    try {
      this.db.prepare(
        `INSERT INTO events (sequence, id, type, at, stream_id, payload, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.sequence,
        event.id,
        event.type,
        event.at,
        event.streamId,
        JSON.stringify(event.payload),
        JSON.stringify(event.explanation),
      );
    } catch (error) {
      throw new ConflictError("failed to append event", {
        id: event.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return event;
  }

  appendMany(inputs: readonly AppendEventInput<DomainEventType>[]): DomainEvent[] {
    return inputs.map((input) => this.append(input));
  }

  readAll(): DomainEvent[] {
    return this.mapRows(
      this.db.prepare("SELECT * FROM events ORDER BY sequence ASC").all() as Record<string, unknown>[],
    );
  }

  readStream(streamId: string): DomainEvent[] {
    return this.mapRows(
      this.db
        .prepare("SELECT * FROM events WHERE stream_id = ? ORDER BY sequence ASC")
        .all(streamId) as Record<string, unknown>[],
    );
  }

  readFrom(sequence: number): DomainEvent[] {
    return this.mapRows(
      this.db
        .prepare("SELECT * FROM events WHERE sequence >= ? ORDER BY sequence ASC")
        .all(sequence) as Record<string, unknown>[],
    );
  }

  lastSequence(): number {
    const row = this.db.prepare("SELECT MAX(sequence) AS max_sequence FROM events").get() as
      | { max_sequence: number | null }
      | undefined;
    return row?.max_sequence ?? 0;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number };
    return row.count;
  }

  clear(): void {
    this.db.exec("DELETE FROM events");
  }

  private mapRows(rows: Record<string, unknown>[]): DomainEvent[] {
    return rows.map((row) =>
      Object.freeze({
        id: String(row.id),
        type: row.type as DomainEvent["type"],
        at: Number(row.at),
        streamId: String(row.stream_id),
        sequence: Number(row.sequence),
        payload: JSON.parse(String(row.payload)),
        explanation: JSON.parse(String(row.explanation)),
      }),
    ) as DomainEvent[];
  }
}
