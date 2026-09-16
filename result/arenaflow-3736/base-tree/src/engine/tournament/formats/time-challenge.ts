import { InvalidArgumentError } from "../../../errors.js";
import type { EpochMillis } from "../../../clock.js";

export interface TimeWindow {
  readonly startsAt: EpochMillis;
  readonly endsAt: EpochMillis;
}

export function createTimeWindow(startsAt: EpochMillis, durationMs: number): TimeWindow {
  if (durationMs <= 0) {
    throw new InvalidArgumentError("time challenge duration must be positive", { durationMs });
  }
  return { startsAt, endsAt: startsAt + durationMs };
}

export function isWithinWindow(window: TimeWindow, at: EpochMillis): boolean {
  return at >= window.startsAt && at <= window.endsAt;
}

export function remainingMs(window: TimeWindow, at: EpochMillis): number {
  return Math.max(0, window.endsAt - at);
}

export function timeChallengeScore(rawScore: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    throw new InvalidArgumentError("duration must be positive");
  }
  const remainingRatio = Math.max(0, (durationMs - elapsedMs) / durationMs);
  return rawScore + Math.floor(rawScore * remainingRatio);
}
