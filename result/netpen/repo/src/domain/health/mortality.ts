/**
 * Mortality.
 *
 * Fish die every day on every site, and the number on its own says nothing.
 * Two hundred dead out of two hundred thousand is a normal Tuesday; the same
 * two hundred out of eight thousand is an incident. So everything here is a
 * rate against the standing population rather than a count, and the standing
 * population is recomputed from the record rather than carried as a running
 * figure that drifts.
 *
 * The cause matters as much as the number. A site's cycle mortality is roughly
 * a tenth of what went in, and where that tenth went decides what gets changed
 * next cycle. Recording it as one lump loses the only useful part.
 */

import { daysBetween, type Instant } from '../time/duration';

export type MortalityCause =
  | 'natural'
  | 'handling'
  | 'treatment'
  | 'disease'
  | 'winter-ulcer'
  | 'jellyfish'
  | 'algae'
  | 'predation'
  | 'escape-damage'
  | 'unknown';

export const MORTALITY_CAUSES: readonly MortalityCause[] = [
  'natural',
  'handling',
  'treatment',
  'disease',
  'winter-ulcer',
  'jellyfish',
  'algae',
  'predation',
  'escape-damage',
  'unknown',
];

export const CAUSE_LABELS: Record<MortalityCause, string> = {
  natural: 'Natural',
  handling: 'Handling',
  treatment: 'Treatment',
  disease: 'Disease',
  'winter-ulcer': 'Winter ulcer',
  jellyfish: 'Jellyfish',
  algae: 'Algal bloom',
  predation: 'Predation',
  'escape-damage': 'Net damage',
  unknown: 'Unrecorded',
};

/**
 * Causes that point at something the site did rather than something that
 * happened to it. These are the ones a cycle review can actually act on.
 */
export const OPERATIONAL_CAUSES: readonly MortalityCause[] = [
  'handling',
  'treatment',
  'escape-damage',
];

export function isOperational(cause: MortalityCause): boolean {
  return OPERATIONAL_CAUSES.includes(cause);
}

export interface MortalityRecord {
  readonly at: Instant;
  readonly count: number;
  /** Mean weight of the fish that died, grams. */
  readonly meanWeightG: number;
  readonly cause: MortalityCause;
}

export function totalCount(records: readonly MortalityRecord[]): number {
  return records.reduce((total, record) => total + record.count, 0);
}

export function totalBiomassKg(records: readonly MortalityRecord[]): number {
  return records.reduce((total, record) => total + (record.count * record.meanWeightG) / 1_000, 0);
}

export function countByCause(records: readonly MortalityRecord[]): Record<MortalityCause, number> {
  const tally = Object.fromEntries(MORTALITY_CAUSES.map((cause) => [cause, 0])) as Record<
    MortalityCause,
    number
  >;

  for (const record of records) {
    tally[record.cause] += record.count;
  }
  return tally;
}

/**
 * Fish still in the pen. Recomputed from what went in and what has left, so a
 * corrected mortality record corrects the standing count with it.
 */
export function standingCount(
  stockedCount: number,
  records: readonly MortalityRecord[],
  harvestedCount = 0,
): number {
  const remaining = stockedCount - totalCount(records) - harvestedCount;
  return remaining > 0 ? remaining : 0;
}

/** Cumulative mortality as a percentage of what was put in. */
export function cumulativePercent(
  stockedCount: number,
  records: readonly MortalityRecord[],
): number {
  if (stockedCount <= 0) return 0;
  return (totalCount(records) / stockedCount) * 100;
}

/** Survival, which is what the budget is written against. */
export function survivalPercent(stockedCount: number, records: readonly MortalityRecord[]): number {
  return 100 - cumulativePercent(stockedCount, records);
}

/**
 * Daily rate over a window, as a percentage of the population standing at the
 * start of it. This is the number that distinguishes a normal week from an
 * incident, and it is the one the vet asks for.
 */
export function dailyRatePercent(
  records: readonly MortalityRecord[],
  standingAtStart: number,
  from: Instant,
  to: Instant,
): number | null {
  const days = daysBetween(from, to);
  if (days <= 0 || standingAtStart <= 0) return null;

  const died = records
    .filter((record) => record.at >= from && record.at < to)
    .reduce((total, record) => total + record.count, 0);

  return (died / standingAtStart / days) * 100;
}

/** What a healthy site runs at, and where it stops being healthy. */
export const NORMAL_DAILY_PERCENT = 0.02;
export const ELEVATED_DAILY_PERCENT = 0.05;
export const INCIDENT_DAILY_PERCENT = 0.2;

export type MortalityLevel = 'normal' | 'elevated' | 'incident' | 'unknown';

export function levelFor(dailyPercent: number | null): MortalityLevel {
  if (dailyPercent === null || !Number.isFinite(dailyPercent)) return 'unknown';
  if (dailyPercent >= INCIDENT_DAILY_PERCENT) return 'incident';
  if (dailyPercent >= ELEVATED_DAILY_PERCENT) return 'elevated';
  return 'normal';
}

export const LEVEL_LABELS: Record<MortalityLevel, string> = {
  normal: 'Within normal daily loss',
  elevated: 'Elevated, worth a look',
  incident: 'Incident level, report it',
  unknown: 'No population to measure against',
};

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} %`;
}
