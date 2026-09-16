/**
 * The thermal growth coefficient model.
 *
 * The standard way a salmon farm budgets growth. It rests on the observation
 * that the cube root of body weight increases very nearly linearly with
 * accumulated degree-days:
 *
 *   W2^(1/3) = W1^(1/3) + TGC / 1000 * sum(T * days)
 *
 * The thousand is a scaling convention, not physics: it exists so a TGC comes
 * out as a number between about 2 and 4 rather than as 0.003, and every feed
 * supplier's table is quoted on that convention.
 *
 * TGC is not a constant. It falls off at the extremes of temperature, it drops
 * after a handling event, and it differs by a tenth or two between year classes
 * from the same hatchery. Treating it as constant across a whole cycle is what
 * the model is for, and knowing that is why the fitted value from the pen's own
 * history beats the supplier's number every time.
 */

export const TGC_SCALE = 1_000;

/** The band a healthy Atlantic salmon grow-out sits in. */
export const TGC_MIN = 1.0;
export const TGC_MAX = 5.0;

export function isPlausibleTgc(tgc: number): boolean {
  return Number.isFinite(tgc) && tgc >= TGC_MIN && tgc <= TGC_MAX;
}

function cubeRoot(value: number): number {
  return Math.cbrt(value);
}

/**
 * Weight after accumulating degree-days from a starting weight.
 *
 * Clamped at zero rather than allowed to go imaginary: a negative TGC on a
 * long cold spell can drive the cube root below zero, and a fish of negative
 * weight in a biomass total is worse than a fish of no weight.
 */
export function weightAfter(startWeightG: number, degreeDays: number, tgc: number): number {
  if (startWeightG < 0) {
    throw new RangeError('Start weight cannot be negative');
  }
  const root = cubeRoot(startWeightG) + (tgc * degreeDays) / TGC_SCALE;
  return root > 0 ? root ** 3 : 0;
}

/**
 * Degree-days needed to get from one weight to another at a given TGC.
 * Negative when the target is below the start, which is a legitimate answer
 * to "how far back was the fish this size".
 */
export function degreeDaysBetweenWeights(
  fromWeightG: number,
  toWeightG: number,
  tgc: number,
): number {
  if (tgc === 0) return Number.POSITIVE_INFINITY;
  return (TGC_SCALE * (cubeRoot(toWeightG) - cubeRoot(fromWeightG))) / tgc;
}

/**
 * Fit a TGC to what the pen actually did. This is the number worth budgeting
 * on, because it carries the site's own handling, its own genetics and its own
 * feeding discipline rather than a supplier's best case.
 */
export function fitTgc(fromWeightG: number, toWeightG: number, degreeDays: number): number {
  if (degreeDays <= 0) {
    throw new RangeError('Cannot fit a growth coefficient over no accumulated heat');
  }
  return (TGC_SCALE * (cubeRoot(toWeightG) - cubeRoot(fromWeightG))) / degreeDays;
}

export interface GrowthStep {
  readonly degreeDays: number;
  readonly weightG: number;
}

/**
 * Walk a weight forward over a series of daily temperatures. Returned as a
 * series rather than an end point because the budget is compared week by week
 * against what the pen weighed, and the shape of the divergence says more than
 * the final number.
 */
export function projectWeights(
  startWeightG: number,
  dailyMeansC: readonly number[],
  tgc: number,
): GrowthStep[] {
  const steps: GrowthStep[] = [{ degreeDays: 0, weightG: startWeightG }];
  let degreeDays = 0;

  for (const meanC of dailyMeansC) {
    degreeDays += meanC > 0 ? meanC : 0;
    steps.push({ degreeDays, weightG: weightAfter(startWeightG, degreeDays, tgc) });
  }

  return steps;
}

/**
 * Reduction applied to TGC after a handling event. Crowding, treatment and
 * grading all cost growth for a fortnight or so, and a budget that ignores it
 * runs ahead of the pen from the first bath onward.
 */
export const HANDLING_TGC_PENALTY = 0.35;
export const HANDLING_RECOVERY_DAYS = 14;

/**
 * TGC to apply on a given day after a handling event, easing linearly back to
 * the unpenalised value over the recovery period.
 */
export function tgcAfterHandling(baseTgc: number, daysSinceHandling: number): number {
  if (daysSinceHandling < 0) return baseTgc;
  if (daysSinceHandling >= HANDLING_RECOVERY_DAYS) return baseTgc;
  const recovered = daysSinceHandling / HANDLING_RECOVERY_DAYS;
  return baseTgc * (1 - HANDLING_TGC_PENALTY * (1 - recovered));
}

export function formatTgc(tgc: number | null): string {
  if (tgc === null || !Number.isFinite(tgc)) return '—';
  return tgc.toFixed(2);
}
