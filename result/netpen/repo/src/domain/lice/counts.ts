/**
 * Sea lice counts.
 *
 * A pen holds two hundred thousand fish and the count is taken on twenty of
 * them. Everything about how that number is reported has to respect the fact
 * that it is a sample, because the figure goes on a public register and the
 * difference between 0.48 and 0.52 adult females decides whether a site is
 * treating this week.
 *
 * Lice are overdispersed: they cluster on individual fish far more than chance
 * would give, so a handful of heavily infested fish sit alongside many clean
 * ones. That means the spread of a sample is wider than a Poisson assumption
 * predicts, and an interval built on Poisson is too narrow. The interval here
 * is built from the sample's own variance, which makes no assumption about the
 * shape at all.
 *
 * Only Lepeophtheirus salmonis is regulated. Caligus is counted separately and
 * is not what the threshold is about, which is why the two never get added.
 */

/** Life stages counted on a fish, in the order they are recorded. */
export type LiceStage = 'chalimus' | 'preAdult' | 'adultMale' | 'adultFemale';

export const LICE_STAGES: readonly LiceStage[] = [
  'chalimus',
  'preAdult',
  'adultMale',
  'adultFemale',
];

export const STAGE_LABELS: Record<LiceStage, string> = {
  chalimus: 'Chalimus',
  preAdult: 'Pre-adult and adult male',
  adultMale: 'Adult male',
  adultFemale: 'Adult female',
};

/** What was found on one fish. */
export interface FishCount {
  readonly chalimus: number;
  readonly preAdult: number;
  readonly adultMale: number;
  readonly adultFemale: number;
  /** Caligus elongatus, counted but not regulated. */
  readonly caligus: number;
}

export const EMPTY_FISH: FishCount = {
  chalimus: 0,
  preAdult: 0,
  adultMale: 0,
  adultFemale: 0,
  caligus: 0,
};

export function stageTotal(fish: FishCount): number {
  return fish.chalimus + fish.preAdult + fish.adultMale + fish.adultFemale;
}

export interface StageAverages {
  readonly chalimus: number;
  readonly preAdult: number;
  readonly adultMale: number;
  readonly adultFemale: number;
  readonly caligus: number;
  readonly mobile: number;
}

/**
 * Mean per fish for each stage. Mobile is the sum of everything past the
 * attached stage, which is the number some regimes report instead.
 */
/**
 * Fish examined per pen per week. Twenty is the minimum both regimes ask for,
 * and a count of fewer is filed rather than refused: the register would rather
 * hold a short count with a note against it than nothing at all.
 *
 * It lives here rather than beside the generated data because it is a rule the
 * screens judge an entry against, and a rule kept in the fixtures is a rule
 * that disappears the day the fixtures do.
 */
export const MINIMUM_SAMPLE = 20;

export function averages(sample: readonly FishCount[]): StageAverages | null {
  if (sample.length === 0) return null;

  const totals = sample.reduce(
    (running, fish) => ({
      chalimus: running.chalimus + fish.chalimus,
      preAdult: running.preAdult + fish.preAdult,
      adultMale: running.adultMale + fish.adultMale,
      adultFemale: running.adultFemale + fish.adultFemale,
      caligus: running.caligus + fish.caligus,
    }),
    { ...EMPTY_FISH },
  );

  const n = sample.length;
  return {
    chalimus: totals.chalimus / n,
    preAdult: totals.preAdult / n,
    adultMale: totals.adultMale / n,
    adultFemale: totals.adultFemale / n,
    caligus: totals.caligus / n,
    mobile: (totals.preAdult + totals.adultMale + totals.adultFemale) / n,
  };
}

export interface CountInterval {
  readonly mean: number;
  readonly standardError: number;
  readonly lower: number;
  readonly upper: number;
  readonly sampleSize: number;
}

/**
 * Student's t at 95 percent, for the small samples a lice count uses. Anything
 * past thirty is close enough to the normal that the table stops.
 */
const T_95: Readonly<Record<number, number>> = {
  2: 12.706,
  3: 4.303,
  4: 3.182,
  5: 2.776,
  6: 2.571,
  7: 2.447,
  8: 2.365,
  9: 2.306,
  10: 2.262,
  12: 2.201,
  15: 2.145,
  20: 2.093,
  25: 2.064,
  30: 2.045,
};

export function tValue(sampleSize: number): number {
  if (sampleSize < 2) return Number.POSITIVE_INFINITY;
  const sizes = Object.keys(T_95)
    .map(Number)
    .sort((a, b) => a - b);
  for (const size of sizes) {
    if (sampleSize <= size) return T_95[size]!;
  }
  return 1.96;
}

/**
 * Interval around the mean of one stage, from the sample's own variance. The
 * lower bound is clipped at zero because a negative count of lice is not a
 * thing anyone can act on.
 */
export function intervalFor(sample: readonly FishCount[], stage: LiceStage): CountInterval | null {
  if (sample.length === 0) return null;
  const values = sample.map((fish) => fish[stage]);
  const n = values.length;
  const mean = values.reduce((total, value) => total + value, 0) / n;

  if (n < 2) {
    return { mean, standardError: Number.NaN, lower: mean, upper: mean, sampleSize: n };
  }

  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  const margin = tValue(n) * standardError;

  return {
    mean,
    standardError,
    lower: Math.max(0, mean - margin),
    upper: mean + margin,
    sampleSize: n,
  };
}

/**
 * How clustered the lice are. A ratio of variance to mean near one is random
 * scatter; well above one means a few fish are carrying most of the burden,
 * which is the usual case and is why the sample has to be taken across the pen
 * rather than from wherever the crowd is thickest.
 */
export function dispersionIndex(sample: readonly FishCount[], stage: LiceStage): number | null {
  if (sample.length < 2) return null;
  const values = sample.map((fish) => fish[stage]);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean <= 0) return null;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return variance / mean;
}

/**
 * Site average across pens, weighted by the number of fish each pen holds. An
 * unweighted mean of pen means lets a nearly empty pen swing the site figure,
 * and the register wants the site figure.
 */
export interface PenAverage {
  readonly penId: string;
  readonly adultFemale: number;
  readonly fishCount: number;
}

export function siteAverage(pens: readonly PenAverage[]): number | null {
  const stocked = pens.filter((pen) => pen.fishCount > 0);
  if (stocked.length === 0) return null;
  const fish = stocked.reduce((total, pen) => total + pen.fishCount, 0);
  const lice = stocked.reduce((total, pen) => total + pen.adultFemale * pen.fishCount, 0);
  return lice / fish;
}

export function formatLice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}
