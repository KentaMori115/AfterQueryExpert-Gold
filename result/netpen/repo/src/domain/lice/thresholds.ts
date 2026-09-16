/**
 * Lice thresholds and what crossing one obliges a site to do.
 *
 * Two regimes matter to a North Atlantic operator and they are not the same
 * shape. The Norwegian rule is a single hard limit on adult females, tightened
 * for the six weeks in spring when wild smolt are running out of the rivers.
 * The Scottish rule is two levels: the first brings the site onto a reporting
 * footing, the second brings the regulator in.
 *
 * The tightened spring window is the part that catches people out. It is
 * defined by ISO week, it is a factor of two and a half tighter, and a site
 * that was comfortable in week 15 can be in breach in week 16 without a single
 * louse having changed.
 */

import type { IsoWeek } from '../time/duration';

export type Regime = 'norway' | 'scotland';

/** Weeks the tightened Norwegian limit applies over, inclusive. */
export const SPRING_WINDOW_FIRST_WEEK = 16;
export const SPRING_WINDOW_LAST_WEEK = 21;

export const NORWAY_STANDARD_LIMIT = 0.5;
export const NORWAY_SPRING_LIMIT = 0.2;
export const SCOTLAND_REPORTING_LEVEL = 0.5;
export const SCOTLAND_ENFORCEMENT_LEVEL = 1.0;

export function isSpringWindow(week: IsoWeek): boolean {
  return week.week >= SPRING_WINDOW_FIRST_WEEK && week.week <= SPRING_WINDOW_LAST_WEEK;
}

/** The adult female limit in force for a regime in a given week. */
export function limitFor(regime: Regime, week: IsoWeek): number {
  if (regime === 'scotland') return SCOTLAND_REPORTING_LEVEL;
  return isSpringWindow(week) ? NORWAY_SPRING_LIMIT : NORWAY_STANDARD_LIMIT;
}

export type LiceStatus = 'clear' | 'approaching' | 'over-limit' | 'enforcement';

/** Fraction of the limit at which a site starts arranging a treatment slot. */
export const APPROACHING_FRACTION = 0.8;

export function statusFor(regime: Regime, week: IsoWeek, adultFemale: number): LiceStatus {
  if (!Number.isFinite(adultFemale)) return 'clear';
  const limit = limitFor(regime, week);

  if (regime === 'scotland' && adultFemale >= SCOTLAND_ENFORCEMENT_LEVEL) {
    return 'enforcement';
  }
  if (adultFemale > limit) return 'over-limit';
  if (adultFemale >= limit * APPROACHING_FRACTION) return 'approaching';
  return 'clear';
}

export const STATUS_LABELS: Record<LiceStatus, string> = {
  clear: 'Inside the limit',
  approaching: 'Approaching the limit, book a slot',
  'over-limit': 'Over the limit, treatment required',
  enforcement: 'At the enforcement level, the regulator is involved',
};

/**
 * Days a site has to act once it goes over. Both regimes give a fortnight to
 * get the count back down, and a site that has already been over recently gets
 * no grace at all.
 */
export const DAYS_TO_ACT = 14;

export function daysToAct(consecutiveWeeksOver: number): number {
  return consecutiveWeeksOver > 1 ? 0 : DAYS_TO_ACT;
}

export interface WeeklyCount {
  readonly week: IsoWeek;
  readonly adultFemale: number;
}

/**
 * Lice-days: the count integrated over time, in louse-weeks per fish. It is
 * the number that says how much pressure a site has actually put on the water,
 * as opposed to whether it happened to be under the limit on counting day.
 * A site that sits at 0.49 all year exports far more than one that spikes once
 * and treats.
 */
export function licePressure(counts: readonly WeeklyCount[]): number {
  return counts.reduce(
    (total, count) => total + (Number.isFinite(count.adultFemale) ? count.adultFemale : 0),
    0,
  );
}

/** Consecutive weeks at the end of the run that were over the limit. */
export function consecutiveWeeksOver(counts: readonly WeeklyCount[], regime: Regime): number {
  let run = 0;
  for (let index = counts.length - 1; index >= 0; index -= 1) {
    const count = counts[index]!;
    if (count.adultFemale > limitFor(regime, count.week)) run += 1;
    else break;
  }
  return run;
}

/**
 * Whether a treatment is required, and why. Separated from the status because
 * the status describes a number and this describes an obligation, and the two
 * come apart: a site can be inside the limit this week and still owe a
 * treatment from being over the fortnight before.
 */
export interface TreatmentObligation {
  readonly required: boolean;
  readonly reason: string | null;
  readonly daysRemaining: number | null;
}

export function treatmentObligation(
  counts: readonly WeeklyCount[],
  regime: Regime,
): TreatmentObligation {
  const latest = counts[counts.length - 1];
  if (!latest) {
    return { required: false, reason: null, daysRemaining: null };
  }

  const run = consecutiveWeeksOver(counts, regime);
  if (run === 0) {
    return { required: false, reason: null, daysRemaining: null };
  }

  const limit = limitFor(regime, latest.week);
  return {
    required: true,
    reason:
      run > 1
        ? `Over ${limit.toFixed(1)} for ${run} consecutive weeks`
        : `Over ${limit.toFixed(1)} this week`,
    daysRemaining: daysToAct(run),
  };
}
