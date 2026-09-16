import type { Milliseconds } from "./units.js";
import { ms, raw } from "./units.js";

/**
 * Half open time intervals on the show clock.
 *
 * Everything in a display occupies a window rather than an instant. A shell
 * fills the sky from its break until the last star burns out, a cake occupies
 * the ground from its first shot to its last, and a rail draws current from
 * the moment the panel closes the circuit until the ematch parts. All three
 * questions are the same question, so they share one type.
 *
 * The interval is half open, `[start, end)`. Two windows that touch at a point
 * do not overlap. That is the convention a firing table needs, because a cake
 * that ends at 40.000 and a shell that breaks at 40.000 are consecutive, not
 * simultaneous.
 */
export interface Interval {
  readonly start: Milliseconds;
  readonly end: Milliseconds;
}

export function interval(start: Milliseconds, end: Milliseconds): Interval {
  if (raw(end) < raw(start)) {
    throw new RangeError(
      `interval ends at ${raw(end)} before it starts at ${raw(start)}`,
    );
  }
  return { start, end };
}

export function fromDuration(
  start: Milliseconds,
  duration: Milliseconds,
): Interval {
  return interval(start, ms(raw(start) + raw(duration)));
}

export function durationOf(value: Interval): Milliseconds {
  return ms(raw(value.end) - raw(value.start));
}

export function isEmpty(value: Interval): boolean {
  return raw(value.end) === raw(value.start);
}

export function contains(value: Interval, at: Milliseconds): boolean {
  return raw(at) >= raw(value.start) && raw(at) < raw(value.end);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return raw(a.start) < raw(b.end) && raw(b.start) < raw(a.end);
}

export function intersection(a: Interval, b: Interval): Interval | undefined {
  const start = Math.max(raw(a.start), raw(b.start));
  const end = Math.min(raw(a.end), raw(b.end));
  return end > start ? interval(ms(start), ms(end)) : undefined;
}

/** The window that covers both, including any gap between them. */
export function hull(a: Interval, b: Interval): Interval {
  return interval(
    ms(Math.min(raw(a.start), raw(b.start))),
    ms(Math.max(raw(a.end), raw(b.end))),
  );
}

export function shift(value: Interval, by: Milliseconds): Interval {
  return interval(ms(raw(value.start) + raw(by)), ms(raw(value.end) + raw(by)));
}

export function compareIntervals(a: Interval, b: Interval): number {
  const byStart = raw(a.start) - raw(b.start);
  return byStart !== 0 ? byStart : raw(a.end) - raw(b.end);
}

export function sortIntervals(values: readonly Interval[]): Interval[] {
  return [...values].sort(compareIntervals);
}

/**
 * Collapse a list into the smallest set of intervals covering the same time.
 * Touching intervals merge, since an unbroken run of activity is one run even
 * if it was written as two.
 */
export function merge(values: readonly Interval[]): Interval[] {
  const sorted = sortIntervals(values).filter((value) => !isEmpty(value));
  const merged: Interval[] = [];
  for (const value of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && raw(value.start) <= raw(last.end)) {
      merged[merged.length - 1] = interval(
        last.start,
        ms(Math.max(raw(last.end), raw(value.end))),
      );
    } else {
      merged.push(value);
    }
  }
  return merged;
}

/** Total time covered, counting overlapping windows once. */
export function coverage(values: readonly Interval[]): Milliseconds {
  return ms(
    merge(values).reduce((total, value) => total + raw(durationOf(value)), 0),
  );
}

/** The quiet stretches between merged windows, which is where a lull shows. */
export function gaps(values: readonly Interval[]): Interval[] {
  const merged = merge(values);
  const result: Interval[] = [];
  for (let i = 1; i < merged.length; i += 1) {
    const previous = merged[i - 1];
    const current = merged[i];
    if (previous !== undefined && current !== undefined) {
      result.push(interval(previous.end, current.start));
    }
  }
  return result;
}

/**
 * The largest number of intervals live at any one instant, and when that
 * happens. This is the shape of a density check, whether the thing being
 * counted is shells in the air or amps on a rail.
 */
export interface PeakOverlap {
  readonly count: number;
  readonly at: Milliseconds;
}

export function peakOverlap(values: readonly Interval[]): PeakOverlap {
  const events: { at: number; delta: number }[] = [];
  for (const value of values) {
    if (isEmpty(value)) {
      continue;
    }
    events.push({ at: raw(value.start), delta: 1 });
    events.push({ at: raw(value.end), delta: -1 });
  }
  events.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.delta - b.delta));
  let live = 0;
  let best = 0;
  let bestAt = 0;
  for (const event of events) {
    live += event.delta;
    if (live > best) {
      best = live;
      bestAt = event.at;
    }
  }
  return { count: best, at: ms(bestAt) };
}

/** Every pair that overlaps, by index, so a report can name both sides. */
export function overlappingPairs(
  values: readonly Interval[],
): [number, number][] {
  const order = values
    .map((value, index) => ({ value, index }))
    .filter((entry) => !isEmpty(entry.value))
    .sort((a, b) => compareIntervals(a.value, b.value));
  const pairs: [number, number][] = [];
  for (let i = 0; i < order.length; i += 1) {
    const left = order[i];
    if (left === undefined) {
      continue;
    }
    for (let j = i + 1; j < order.length; j += 1) {
      const right = order[j];
      if (right === undefined) {
        continue;
      }
      if (raw(right.value.start) >= raw(left.value.end)) {
        break;
      }
      const a = Math.min(left.index, right.index);
      const b = Math.max(left.index, right.index);
      pairs.push([a, b]);
    }
  }
  return pairs;
}
