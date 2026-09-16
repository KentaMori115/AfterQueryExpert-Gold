/**
 * The arithmetic the rest of portfire leans on.
 *
 * Nothing here is clever. It is here because rounding a firing time and
 * rounding a rail current want the same helper, and because a peak current
 * report that computes its own mean gets it subtly wrong on an empty list.
 */

export function clamp(value: number, low: number, high: number): number {
  if (low > high) {
    throw new RangeError(`clamp bounds are backwards, ${low} to ${high}`);
  }
  return Math.min(high, Math.max(low, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Where `value` sits between `from` and `to`, clamped into [0, 1]. */
export function inverseLerp(from: number, to: number, value: number): number {
  if (from === to) {
    return 0;
  }
  return clamp((value - from) / (to - from), 0, 1);
}

/** Round to a step, so `roundTo(83, 40)` snaps a time onto a frame. */
export function roundTo(value: number, step: number): number {
  if (step <= 0) {
    throw new RangeError("a rounding step has to be positive");
  }
  const snapped = Math.round(value / step) * step;
  return Math.round(snapped * 1e6) / 1e6;
}

export function floorTo(value: number, step: number): number {
  if (step <= 0) {
    throw new RangeError("a rounding step has to be positive");
  }
  return Math.round(Math.floor(value / step) * step * 1e6) / 1e6;
}

export function ceilTo(value: number, step: number): number {
  if (step <= 0) {
    throw new RangeError("a rounding step has to be positive");
  }
  return Math.round(Math.ceil(value / step) * step * 1e6) / 1e6;
}

export function approxEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/**
 * Linear interpolation between order statistics, the same convention numpy
 * uses. An empty list gives zero rather than throwing, because every caller is
 * building a report and a missing number there is a nuisance, not a fault.
 */
export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lerp(lowValue, highValue, position - low);
}

export function variance(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return (
    sum(values.map((value) => (value - average) ** 2)) / (values.length - 1)
  );
}

export function stdDev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

export function minOf(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values);
}

export function maxOf(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

export function isMonotonic(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous !== undefined && current !== undefined && current < previous) {
      return false;
    }
  }
  return true;
}

export interface Bucket {
  readonly low: number;
  readonly high: number;
  readonly count: number;
}

/**
 * Even width buckets over the range of the data. Used by the density report,
 * which answers how many shots land in each ten second slice of the show.
 */
export function histogram(
  values: readonly number[],
  bucketCount: number,
): Bucket[] {
  if (bucketCount < 1 || !Number.isInteger(bucketCount)) {
    throw new RangeError("a histogram needs a positive whole bucket count");
  }
  if (values.length === 0) {
    return [];
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const width = high === low ? 1 : (high - low) / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);
  for (const value of values) {
    const index = clamp(Math.floor((value - low) / width), 0, bucketCount - 1);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((count, index) => ({
    low: low + index * width,
    high: low + (index + 1) * width,
    count,
  }));
}

/** Bucket values into fixed width slices starting at zero. */
export function bucketBy(
  values: readonly number[],
  width: number,
): Map<number, number> {
  if (width <= 0) {
    throw new RangeError("bucket width has to be positive");
  }
  const buckets = new Map<number, number>();
  for (const value of values) {
    const key = Math.floor(value / width) * width;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}
