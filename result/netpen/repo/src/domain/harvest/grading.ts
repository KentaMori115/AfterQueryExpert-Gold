/**
 * Harvest grading.
 *
 * A pen is not sold at its mean weight. It is sold into size bands, priced per
 * band, and the bands are set on gutted weight rather than live. The gap
 * between "the pen averages 4.6 kg" and "what the pen is worth" is entirely in
 * how the weights are spread, so the spread is the thing that has to be
 * modelled rather than assumed away.
 *
 * There is a second axis. Quality grade is separate from size: a superior fish
 * is one without wounds, deformity or maturation, and a pen can be perfectly
 * sized and still lose a fifth of its value to downgrades after a hard winter
 * or a late treatment. The two are combined at the end because that is what
 * the settlement does, but they are estimated apart because they have nothing
 * to do with each other.
 */

import { guttedYield } from '../growth/condition';
import { fractionBetween, lognormalFrom } from '../stats/distribution';

/** Bands the trade prices in, on gutted weight in kilogrammes. */
export interface WeightBand {
  readonly label: string;
  readonly fromKg: number;
  /** Null on the open top band. */
  readonly toKg: number | null;
}

export const STANDARD_BANDS: readonly WeightBand[] = [
  { label: '1-2 kg', fromKg: 1, toKg: 2 },
  { label: '2-3 kg', fromKg: 2, toKg: 3 },
  { label: '3-4 kg', fromKg: 3, toKg: 4 },
  { label: '4-5 kg', fromKg: 4, toKg: 5 },
  { label: '5-6 kg', fromKg: 5, toKg: 6 },
  { label: '6-7 kg', fromKg: 6, toKg: 7 },
  { label: '7+ kg', fromKg: 7, toKg: null },
];

export type QualityGrade = 'superior' | 'ordinary' | 'production';

export const GRADE_LABELS: Record<QualityGrade, string> = {
  superior: 'Superior',
  ordinary: 'Ordinary',
  production: 'Production',
};

export interface BandShare {
  readonly band: WeightBand;
  readonly fraction: number;
  readonly countPerThousand: number;
}

/**
 * Split a pen across the size bands.
 *
 * The mean live weight and the spread come from a sample; the condition factor
 * turns live weight into gutted weight, which is what the bands are cut on. A
 * pen with a poor condition factor lands lower in the bands than its live mean
 * suggests, and that is worth seeing before the well boat is booked rather
 * than after the settlement arrives.
 */
export function bandDistribution(
  meanLiveWeightG: number,
  cvPercent: number,
  conditionFactor: number,
  bands: readonly WeightBand[] = STANDARD_BANDS,
): BandShare[] {
  const meanGuttedKg = (meanLiveWeightG * guttedYield(conditionFactor)) / 1_000;
  const shape = lognormalFrom(meanGuttedKg, cvPercent);

  return bands.map((band) => {
    const fraction = fractionBetween(shape, band.fromKg, band.toKg);
    return { band, fraction, countPerThousand: Math.round(fraction * 1_000) };
  });
}

/** The band holding the largest share, which is what a pen is described as. */
export function modalBand(shares: readonly BandShare[]): WeightBand | null {
  let best: BandShare | null = null;
  for (const share of shares) {
    if (best === null || share.fraction > best.fraction) best = share;
  }
  return best?.band ?? null;
}

/** Share landing at or above a band, which is where the money usually is. */
export function fractionAtOrAbove(shares: readonly BandShare[], fromKg: number): number {
  return shares
    .filter((share) => share.band.fromKg >= fromKg)
    .reduce((total, share) => total + share.fraction, 0);
}

export interface GradeSplit {
  readonly superior: number;
  readonly ordinary: number;
  readonly production: number;
}

/** What a clean pen grades at before anything has gone wrong. */
export const BASELINE_GRADE: GradeSplit = {
  superior: 0.94,
  ordinary: 0.05,
  production: 0.01,
};

export interface GradePressures {
  /** Fraction showing wounds, from winter ulcer or handling. */
  readonly wounded: number;
  /** Fraction running mature, which downgrades hard. */
  readonly maturing: number;
  /** Fraction with deformity or other permanent defect. */
  readonly deformed: number;
}

/**
 * Move fish down the grades according to what the pen is carrying. Wounds and
 * maturation take a fish out of superior; deformity takes it all the way to
 * production, which is the one that costs real money.
 */
export function gradeSplit(pressures: GradePressures): GradeSplit {
  const production = Math.min(1, BASELINE_GRADE.production + pressures.deformed);
  const ordinary = Math.min(
    1 - production,
    BASELINE_GRADE.ordinary + pressures.wounded + pressures.maturing,
  );
  const superior = Math.max(0, 1 - production - ordinary);
  return { superior, ordinary, production };
}

export interface HarvestEstimate {
  readonly liveTonnes: number;
  readonly guttedTonnes: number;
  readonly bands: readonly BandShare[];
  readonly grades: GradeSplit;
  readonly modal: WeightBand | null;
}

export function estimateHarvest(
  count: number,
  meanLiveWeightG: number,
  cvPercent: number,
  conditionFactor: number,
  pressures: GradePressures,
): HarvestEstimate {
  const liveTonnes = (count * meanLiveWeightG) / 1_000_000;
  const bands = bandDistribution(meanLiveWeightG, cvPercent, conditionFactor);

  return {
    liveTonnes,
    guttedTonnes: liveTonnes * guttedYield(conditionFactor),
    bands,
    grades: gradeSplit(pressures),
    modal: modalBand(bands),
  };
}

export function formatShare(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(1)} %`;
}
