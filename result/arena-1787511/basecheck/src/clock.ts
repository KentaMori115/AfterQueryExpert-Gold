import { InvalidArgumentError } from "./errors.js";

/**
 * Deterministic clock. All engine decisions use caller-supplied timestamps
 * so identical inputs always produce identical results.
 */
export type EpochMillis = number;

export interface Clock {
  now(): EpochMillis;
}

export class FixedClock implements Clock {
  constructor(private readonly instant: EpochMillis) {
    assertEpochMillis(instant, "instant");
  }

  now(): EpochMillis {
    return this.instant;
  }
}

export class SequenceClock implements Clock {
  private cursor: EpochMillis;

  constructor(start: EpochMillis) {
    assertEpochMillis(start, "start");
    this.cursor = start;
  }

  now(): EpochMillis {
    const value = this.cursor;
    this.cursor += 1;
    return value;
  }
}

export function assertEpochMillis(value: number, label = "timestamp"): EpochMillis {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidArgumentError(`${label} must be a non-negative integer`, { label, value });
  }
  return value;
}

export function compareTimestamps(a: EpochMillis, b: EpochMillis): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
