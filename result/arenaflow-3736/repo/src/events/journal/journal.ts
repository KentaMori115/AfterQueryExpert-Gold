import { ConflictError, InvalidArgumentError } from "../../errors.js";
import { assertEpochMillis, type EpochMillis } from "../../clock.js";
import { createPrefixedId } from "../../ids.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type { DomainEvent, DomainEventType, EventPayloadOf } from "../types.js";

export interface AppendEventInput<T extends DomainEventType> {
  readonly type: T;
  readonly at: EpochMillis;
  readonly streamId: string;
  readonly payload: EventPayloadOf<T>;
  readonly explanation: DecisionExplanation;
  readonly id?: string;
}

export interface EventJournal {
  append<T extends DomainEventType>(input: AppendEventInput<T>): DomainEvent;
  appendMany(inputs: readonly AppendEventInput<DomainEventType>[]): DomainEvent[];
  readAll(): DomainEvent[];
  readStream(streamId: string): DomainEvent[];
  readFrom(sequence: number): DomainEvent[];
  lastSequence(): number;
  count(): number;
  clear(): void;
}

export function makeEvent<T extends DomainEventType>(
  input: AppendEventInput<T>,
  sequence: number,
): DomainEvent {
  assertEpochMillis(input.at, "event.at");
  if (!input.streamId.trim()) {
    throw new InvalidArgumentError("event streamId is required");
  }
  const id = input.id ?? createPrefixedId("evt", `${input.type}_${sequence}`);
  return Object.freeze({
    id,
    type: input.type,
    at: input.at,
    streamId: input.streamId,
    sequence,
    payload: Object.freeze(input.payload) as unknown as EventPayloadOf<T>,
    explanation: input.explanation,
  }) as DomainEvent;
}

export function eventExplanation(
  type: DomainEventType,
  message: string,
  details: Record<string, unknown> = {},
): DecisionExplanation {
  return explain(`event.${type}`, message, details);
}

export function assertMonotonic(events: readonly DomainEvent[]): void {
  let previous = 0;
  for (const event of events) {
    if (event.sequence <= previous) {
      throw new ConflictError("event sequence is not monotonic", {
        previous,
        sequence: event.sequence,
        id: event.id,
      });
    }
    previous = event.sequence;
  }
}
