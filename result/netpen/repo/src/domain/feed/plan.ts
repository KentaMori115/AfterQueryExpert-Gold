/**
 * What to feed today.
 *
 * The table says what the fish could eat. Several things then say they cannot
 * have it, and the answer is the smallest of them. Working it out as a set of
 * constraints rather than a chain of adjustments matters, because the crew
 * need to know which one is binding: "hold at forty percent" is an instruction
 * nobody can argue with once it says "because oxygen is at sixty two".
 *
 * Starving before a handling event is the one that surprises people. Fish are
 * taken off feed for two to three days before crowding so that the gut is
 * empty when they go through a pump, and that hold is not negotiable, so it
 * overrides everything else including a pen that is behind budget.
 */

import { dailyFeedKg, feedRatePercent } from './table';
import { oxygenBand } from '../water/oxygen';

export type FeedConstraint =
  | 'table'
  | 'oxygen'
  | 'pre-handling-starve'
  | 'appetite'
  | 'temperature'
  | 'operator-cap';

export const CONSTRAINT_LABELS: Record<FeedConstraint, string> = {
  table: 'Feeding to table',
  oxygen: 'Held back by oxygen',
  'pre-handling-starve': 'Off feed before handling',
  appetite: 'Reduced on observed appetite',
  temperature: 'Held back by temperature',
  'operator-cap': 'Capped by the operator',
};

/** Days off feed before a crowd, and the fraction allowed on each of them. */
export const STARVE_DAYS = 3;

export function starveFraction(daysToHandling: number | null): number {
  if (daysToHandling === null || daysToHandling > STARVE_DAYS) return 1;
  if (daysToHandling <= 1) return 0;
  // Two days out at a quarter, three days out at a half, then nothing.
  return daysToHandling === 2 ? 0.25 : 0.5;
}

/** Fraction of table feeding each oxygen band supports. */
export function oxygenFraction(saturationPercent: number): number {
  switch (oxygenBand(saturationPercent)) {
    case 'critical':
      return 0;
    case 'low':
      return 0.25;
    case 'reduced':
      return 0.6;
    default:
      return 1;
  }
}

/**
 * Below about four degrees salmon largely stop feeding whatever the table
 * says, and above eighteen appetite falls away again. The table already bends
 * at the warm end; this is the extra hold either side of it.
 */
export function temperatureFraction(temperatureC: number): number {
  if (temperatureC < 2) return 0;
  if (temperatureC < 4) return 0.4;
  if (temperatureC > 19) return 0.5;
  if (temperatureC > 17) return 0.8;
  return 1;
}

export type Appetite = 'keen' | 'normal' | 'slow' | 'off';

export const APPETITE_FRACTION: Record<Appetite, number> = {
  keen: 1,
  normal: 1,
  slow: 0.7,
  off: 0.2,
};

export interface FeedPlanInput {
  readonly biomassKg: number;
  readonly meanWeightG: number;
  readonly temperatureC: number;
  readonly saturationPercent: number;
  readonly appetite: Appetite;
  /** Days until the pen is crowded, or null when nothing is booked. */
  readonly daysToHandling: number | null;
  /** A hard ceiling the operator has set, kilogrammes. Null for none. */
  readonly operatorCapKg: number | null;
}

export interface FeedPlan {
  readonly tableKg: number;
  readonly recommendedKg: number;
  readonly fraction: number;
  readonly binding: FeedConstraint;
  readonly ratePercent: number;
  /** Every constraint and what it would allow, for the crew to read. */
  readonly constraints: readonly {
    readonly constraint: FeedConstraint;
    readonly allowsKg: number;
  }[];
}

/**
 * The smallest of what each constraint allows. Ties go to the constraint
 * earliest in the list, which puts the starve hold ahead of oxygen and oxygen
 * ahead of appetite, because that is the order the crew would explain it in.
 */
export function planFeed(input: FeedPlanInput): FeedPlan {
  const ratePercent = feedRatePercent(input.meanWeightG, input.temperatureC);
  const tableKg = dailyFeedKg(input.biomassKg, input.meanWeightG, input.temperatureC);

  const candidates: { constraint: FeedConstraint; allowsKg: number }[] = [
    { constraint: 'pre-handling-starve', allowsKg: tableKg * starveFraction(input.daysToHandling) },
    { constraint: 'oxygen', allowsKg: tableKg * oxygenFraction(input.saturationPercent) },
    { constraint: 'temperature', allowsKg: tableKg * temperatureFraction(input.temperatureC) },
    { constraint: 'appetite', allowsKg: tableKg * APPETITE_FRACTION[input.appetite] },
    {
      constraint: 'operator-cap',
      allowsKg: input.operatorCapKg === null ? tableKg : input.operatorCapKg,
    },
    { constraint: 'table', allowsKg: tableKg },
  ];

  let binding = candidates[candidates.length - 1]!;
  for (const candidate of candidates) {
    if (candidate.allowsKg < binding.allowsKg) binding = candidate;
  }

  const recommendedKg = Math.max(0, binding.allowsKg);

  return {
    tableKg,
    recommendedKg,
    fraction: tableKg > 0 ? recommendedKg / tableKg : 0,
    binding: binding.constraint,
    ratePercent,
    constraints: candidates,
  };
}

/** Feed for a run of days, for the weekly order. */
export function weeklyFeedKg(plans: readonly FeedPlan[]): number {
  return plans.reduce((total, plan) => total + plan.recommendedKg, 0);
}

export function formatKg(kg: number | null): string {
  if (kg === null || !Number.isFinite(kg)) return '—';
  return kg >= 1_000 ? `${(kg / 1_000).toFixed(2)} t` : `${kg.toFixed(0)} kg`;
}
