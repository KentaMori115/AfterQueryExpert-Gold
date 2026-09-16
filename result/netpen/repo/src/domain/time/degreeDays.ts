/**
 * Degree-days.
 *
 * The currency of everything biological on a site. A fish does not grow by the
 * calendar, it grows by the heat it has been through, and the same is true of
 * how long a medicine takes to clear its flesh. Both the growth model and the
 * withdrawal period are written in degree-days, and a site in a cold spring
 * simply waits longer for both.
 *
 * One degree-day is one day at one degree Celsius above zero. Sea temperature
 * is essentially never below zero at a farmed site, but the floor is applied
 * anyway rather than allowing a hard frost on a surface probe to subtract from
 * a fish's accumulated heat.
 */

import { daysBetween, type DateRange, type Instant, MS_PER_DAY, rangeContains } from './duration';

export interface TemperatureSample {
  /** Midnight of the day the mean belongs to. */
  readonly at: Instant;
  /** Daily mean at the reference depth, degC. */
  readonly meanC: number;
}

/** Degree-days a single day at this temperature is worth. */
export function dayContribution(meanC: number): number {
  return meanC > 0 ? meanC : 0;
}

/**
 * Accumulate over a series of daily means.
 *
 * Each sample stands for one whole day, which is why this is a plain sum
 * rather than an integration between samples. A gap in the series contributes
 * nothing rather than being interpolated across, because a missing day is a
 * day nobody measured and quietly inventing heat for it is how a withdrawal
 * period ends up short.
 */
export function accumulate(samples: readonly TemperatureSample[]): number {
  let total = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample.meanC)) continue;
    total += dayContribution(sample.meanC);
  }
  return total;
}

export function accumulateInRange(samples: readonly TemperatureSample[], range: DateRange): number {
  return accumulate(samples.filter((sample) => rangeContains(range, sample.at)));
}

export interface AccumulationPoint {
  readonly at: Instant;
  readonly meanC: number;
  /** Running total from the first sample. */
  readonly degreeDays: number;
}

/** Running total, for plotting and for finding when a threshold was crossed. */
export function accumulationCurve(samples: readonly TemperatureSample[]): AccumulationPoint[] {
  const points: AccumulationPoint[] = [];
  let total = 0;

  for (const sample of samples) {
    if (!Number.isFinite(sample.meanC)) continue;
    total += dayContribution(sample.meanC);
    points.push({ at: sample.at, meanC: sample.meanC, degreeDays: total });
  }

  return points;
}

/** The day a running total first reaches a target, or null if it never does. */
export function dayReached(
  curve: readonly AccumulationPoint[],
  targetDegreeDays: number,
): Instant | null {
  for (const point of curve) {
    if (point.degreeDays >= targetDegreeDays) return point.at;
  }
  return null;
}

/**
 * Days still to run at a given temperature to reach a target.
 *
 * Returns Infinity at or below zero, because the fish are not accumulating and
 * a projection that says "eleven thousand days" reads as a bug where an
 * infinity reads as "not on this temperature".
 */
export function daysToAccumulate(remainingDegreeDays: number, atC: number): number {
  if (remainingDegreeDays <= 0) return 0;
  const rate = dayContribution(atC);
  return rate > 0 ? remainingDegreeDays / rate : Number.POSITIVE_INFINITY;
}

/**
 * Project a date from a target, walking a forecast of daily means and falling
 * back to the last forecast value once the forecast runs out. Sites hold a
 * fortnight of forecast and a year of normals, and the normals are what carry
 * a projection out to harvest.
 */
export function projectDate(
  from: Instant,
  targetDegreeDays: number,
  forecast: readonly number[],
): Instant | null {
  if (targetDegreeDays <= 0) return from;
  const fallback = forecast[forecast.length - 1];
  if (fallback === undefined || dayContribution(fallback) <= 0) return null;

  let remaining = targetDegreeDays;
  let day = 0;

  // Bounded so a cold forecast cannot spin: five years is far past any cycle.
  while (remaining > 0 && day < 1_825) {
    remaining -= dayContribution(forecast[day] ?? fallback);
    day += 1;
  }

  return remaining > 0 ? null : from + day * MS_PER_DAY;
}

/** Mean daily temperature implied by a total over a period. */
export function impliedMeanC(degreeDays: number, range: DateRange): number | null {
  const days = daysBetween(range.from, range.to);
  return days > 0 ? degreeDays / days : null;
}

export function formatDegreeDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)} k°d` : `${Math.round(value)} °d`;
}
