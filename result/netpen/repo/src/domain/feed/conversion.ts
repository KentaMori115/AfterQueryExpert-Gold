/**
 * Feed conversion.
 *
 * The ratio of feed put in to fish produced, and the single number a site is
 * judged on. There are two of them and they are not interchangeable.
 *
 *   biological FCR  counts the biomass that died as production, because the
 *                   feed that grew it was really eaten by a fish. It measures
 *                   how well the fish convert.
 *
 *   economic FCR    counts only what leaves the site alive. It measures what
 *                   the feed actually bought, and it is always the worse of
 *                   the two because a mortality is feed with nothing to show
 *                   for it.
 *
 * A site quoting the biological figure while the accounts run on the economic
 * one is a site that looks like it is doing better than it is. Both are
 * computed here from the same inputs so the gap between them is visible, and
 * the gap is exactly the cost of the mortality.
 */

export interface ConversionInputs {
  /** Feed put out over the period, kilogrammes. */
  readonly feedKg: number;
  /** Standing biomass at the start, kilogrammes. */
  readonly openingBiomassKg: number;
  /** Standing biomass at the end, kilogrammes. */
  readonly closingBiomassKg: number;
  /** Biomass taken off alive over the period, kilogrammes. */
  readonly harvestedKg: number;
  /** Biomass of fish that died, at the weight they died at. */
  readonly mortalityKg: number;
  /** Biomass put in over the period, kilogrammes. Usually only at stocking. */
  readonly stockedKg: number;
}

/** Production counting the fish that died, which is what the fish converted. */
export function biologicalGainKg(inputs: ConversionInputs): number {
  return (
    inputs.closingBiomassKg +
    inputs.harvestedKg +
    inputs.mortalityKg -
    inputs.openingBiomassKg -
    inputs.stockedKg
  );
}

/** Production counting only what left alive, which is what the feed bought. */
export function economicGainKg(inputs: ConversionInputs): number {
  return inputs.closingBiomassKg + inputs.harvestedKg - inputs.openingBiomassKg - inputs.stockedKg;
}

/**
 * Null rather than Infinity when there was no gain. A pen that lost biomass
 * over a treatment week has no meaningful conversion ratio for that week, and
 * a screen showing a very large number invites somebody to average it into a
 * cycle figure.
 */
export function biologicalFcr(inputs: ConversionInputs): number | null {
  const gain = biologicalGainKg(inputs);
  return gain > 0 ? inputs.feedKg / gain : null;
}

export function economicFcr(inputs: ConversionInputs): number | null {
  const gain = economicGainKg(inputs);
  return gain > 0 ? inputs.feedKg / gain : null;
}

/**
 * What the mortality cost, in kilogrammes of feed. This is the gap between the
 * two ratios expressed as something an accountant recognises.
 */
export function feedLostToMortalityKg(inputs: ConversionInputs): number {
  const biological = biologicalFcr(inputs);
  if (biological === null) return 0;
  return inputs.mortalityKg * biological;
}

/** The band a marine grow-out conversion is expected to land in. */
export const FCR_GOOD_MAX = 1.15;
export const FCR_ACCEPTABLE_MAX = 1.35;

export type FcrBand = 'good' | 'acceptable' | 'poor' | 'unknown';

export function fcrBand(fcr: number | null): FcrBand {
  if (fcr === null || !Number.isFinite(fcr) || fcr <= 0) return 'unknown';
  if (fcr <= FCR_GOOD_MAX) return 'good';
  if (fcr <= FCR_ACCEPTABLE_MAX) return 'acceptable';
  return 'poor';
}

export const FCR_BAND_LABELS: Record<FcrBand, string> = {
  good: 'On or inside budget',
  acceptable: 'Above budget, worth a look at feeding',
  poor: 'Well above budget, something is being wasted',
  unknown: 'No gain to measure against',
};

/**
 * Feed a projected growth curve will need. Walks the weight series rather than
 * applying a ratio to the total gain, because the ratio drifts through a cycle
 * and the whole point of a budget is to know when the feed lorry is needed.
 */
export interface FeedBudgetStep {
  readonly gainKg: number;
  readonly feedKg: number;
  readonly cumulativeFeedKg: number;
}

export function feedBudget(biomassSeriesKg: readonly number[], fcr: number): FeedBudgetStep[] {
  if (fcr <= 0) {
    throw new RangeError('A feed budget needs a positive conversion ratio');
  }

  const steps: FeedBudgetStep[] = [];
  let cumulative = 0;

  for (let index = 1; index < biomassSeriesKg.length; index += 1) {
    const gain = biomassSeriesKg[index]! - biomassSeriesKg[index - 1]!;
    const feed = gain > 0 ? gain * fcr : 0;
    cumulative += feed;
    steps.push({ gainKg: gain, feedKg: feed, cumulativeFeedKg: cumulative });
  }

  return steps;
}

export function formatFcr(fcr: number | null): string {
  if (fcr === null || !Number.isFinite(fcr)) return '—';
  return fcr.toFixed(2);
}
