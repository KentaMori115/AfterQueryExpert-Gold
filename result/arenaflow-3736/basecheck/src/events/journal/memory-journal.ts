import { ConflictError } from "../../errors.js";
import type { DomainEvent, DomainEventType } from "../types.js";
import { assertMonotonic, makeEvent, type AppendEventInput, type EventJournal } from "./journal.js";

export class MemoryEventJournal implements EventJournal {
  private events: DomainEvent[] = [];
  private nextSequence = 1;
  private readonly ids = new Set<string>();

  append<T extends DomainEventType>(input: AppendEventInput<T>): DomainEvent {
    const event = makeEvent(input, this.nextSequence);
    if (this.ids.has(event.id)) {
      throw new ConflictError(`duplicate event id: ${event.id}`, { id: event.id });
    }
    this.events.push(event);
    this.ids.add(event.id);
    this.nextSequence += 1;
    return event;
  }

  appendMany(inputs: readonly AppendEventInput<DomainEventType>[]): DomainEvent[] {
    return inputs.map((input) => this.append(input));
  }

  readAll(): DomainEvent[] {
    return [...this.events];
  }

  readStream(streamId: string): DomainEvent[] {
    return this.events.filter((event) => event.streamId === streamId);
  }

  readFrom(sequence: number): DomainEvent[] {
    return this.events.filter((event) => event.sequence >= sequence);
  }

  lastSequence(): number {
    return this.nextSequence - 1;
  }

  count(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
    this.nextSequence = 1;
    this.ids.clear();
  }

  restore(events: readonly DomainEvent[]): void {
    assertMonotonic(events);
    this.clear();
    for (const event of events) {
      this.events.push(event);
      this.ids.add(event.id);
      this.nextSequence = event.sequence + 1;
    }
  }
}
