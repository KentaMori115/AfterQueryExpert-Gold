/**
 * Growth rate and condition.
 *
 * Specific growth rate is the other way of quoting growth, as a percentage of
 * body weight per day. It is not a substitute for the thermal coefficient: SGR
 * falls steadily through a cycle even when the fish are growing perfectly,
 * because the same absolute gain is a smaller share of a larger fish. It is
 * useful for comparing two pens in the same week and misleading for comparing
 * one pen to itself six months apart, and both of those things get done.
 *
 * Condition factor is weight against the cube of length. It says whether the
 * fish is short and deep or long and thin, which is what decides how it grades
 * at the processor and whether it is being fed to appetite or beyond it.
 */

/** Percent of body weight gained per day between two weighings. */
export function specificGrowthRate(fromWeightG: number, toWeightG: number, days: number): number {
  if (fromWeightG <= 0 || toWeightG <= 0) {
    throw new RangeError('Growth rate needs positive weights at both ends');
  }
  if (days <= 0) {
    throw new RangeError('Growth rate needs a positive number of days');
  }
  return ((Math.log(toWeightG) - Math.log(fromWeightG)) / days) * 100;
}

export function weightFromSgr(fromWeightG: number, sgrPercent: number, days: number): number {
  if (fromWeightG <= 0) {
    throw new RangeError('Growth rate needs a positive start weight');
  }
  return fromWeightG * Math.exp((sgrPercent / 100) * days);
}

/**
 * Fulton's condition factor, K = 100 * W / L^3 with weight in grams and length
 * in centimetres. A well conditioned Atlantic salmon runs about 1.1 to 1.4.
 */
export function conditionFactor(weightG: number, lengthCm: number): number {
  if (lengthCm <= 0) {
    throw new RangeError('Condition factor needs a positive length');
  }
  return (100 * weightG) / lengthCm ** 3;
}

export function lengthForCondition(weightG: number, k: number): number {
  if (k <= 0) {
    throw new RangeError('Condition factor must be positive');
  }
  return Math.cbrt((100 * weightG) / k);
}

export type ConditionBand = 'thin' | 'lean' | 'good' | 'deep' | 'overfat';

export const CONDITION_BANDS: readonly { readonly upTo: number; readonly band: ConditionBand }[] = [
  { upTo: 1.0, band: 'thin' },
  { upTo: 1.1, band: 'lean' },
  { upTo: 1.4, band: 'good' },
  { upTo: 1.55, band: 'deep' },
  { upTo: Number.POSITIVE_INFINITY, band: 'overfat' },
];

export function conditionBand(k: number): ConditionBand {
  for (const entry of CONDITION_BANDS) {
    if (k < entry.upTo) return entry.band;
  }
  return 'overfat';
}

export const CONDITION_LABELS: Record<ConditionBand, string> = {
  thin: 'Thin, check feeding and health',
  lean: 'Lean',
  good: 'Good condition',
  deep: 'Deep, easing back would hold the grade',
  overfat: 'Overfat, grading will suffer',
};

/**
 * Gutted yield. A superior Atlantic salmon loses roughly fifteen percent of
 * its live weight to gilling and gutting, and the loss is slightly larger in a
 * fish carrying more viscera, so the yield is taken from the condition factor
 * rather than as a flat figure.
 */
export const BASE_GUTTED_YIELD = 0.86;

export function guttedYield(k: number): number {
  // Each tenth of condition above 1.2 costs about half a point of yield.
  const adjustment = (k - 1.2) * 0.05;
  const yieldFraction = BASE_GUTTED_YIELD - adjustment;
  if (yieldFraction < 0.75) return 0.75;
  if (yieldFraction > 0.9) return 0.9;
  return yieldFraction;
}

export function guttedWeightG(liveWeightG: number, k: number): number {
  return liveWeightG * guttedYield(k);
}

export function formatSgr(sgrPercent: number | null): string {
  if (sgrPercent === null || !Number.isFinite(sgrPercent)) return '—';
  return `${sgrPercent.toFixed(2)} %/d`;
}

export function formatCondition(k: number | null): string {
  if (k === null || !Number.isFinite(k)) return '—';
  return k.toFixed(2);
}
