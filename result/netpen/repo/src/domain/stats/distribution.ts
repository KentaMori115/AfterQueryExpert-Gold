/**
 * The statistics a site actually uses.
 *
 * Two things drive most of it. Sample counts: lice are counted on twenty fish
 * out of two hundred thousand, and the number that goes on the report needs an
 * interval around it or it means nothing. And size spread: a pen does not
 * harvest at its mean weight, it harvests into size bands, and the money is in
 * what fraction lands in each.
 *
 * Weight in a pen is close to lognormal rather than normal. It is bounded
 * below by zero, it has a tail of large fish and no matching tail of small
 * ones, and the spread grows with the mean. Treating it as normal overstates
 * the small end and understates the top band, which is the expensive direction
 * to be wrong in.
 */

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Mean of an empty sample is undefined');
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Sample standard deviation, the n-1 form. */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) {
    throw new RangeError('Standard deviation needs at least two values');
  }
  const average = mean(values);
  const sum = values.reduce((total, value) => total + (value - average) ** 2, 0);
  return Math.sqrt(sum / (values.length - 1));
}

/** Spread as a percentage of the mean, which is how size spread is quoted. */
export function coefficientOfVariation(values: readonly number[]): number {
  const average = mean(values);
  if (average === 0) {
    throw new RangeError('Coefficient of variation is undefined about a zero mean');
  }
  return (standardDeviation(values) / average) * 100;
}

/**
 * Standard normal cumulative distribution.
 *
 * Abramowitz and Stegun 7.1.26 for the error function, good to about 1.5e-7
 * absolute, which is several orders past anything that matters when the input
 * is a sample of twenty fish.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

export interface LognormalShape {
  /** Mean of the underlying normal. */
  readonly mu: number;
  /** Standard deviation of the underlying normal. */
  readonly sigma: number;
}

/**
 * Recover the underlying normal from the mean and spread of the weights
 * themselves, which is what a sample of a pen gives you.
 */
export function lognormalFrom(meanValue: number, cvPercent: number): LognormalShape {
  if (meanValue <= 0) {
    throw new RangeError('A lognormal fit needs a positive mean');
  }
  if (cvPercent <= 0) {
    throw new RangeError('A lognormal fit needs a positive spread');
  }
  const cv = cvPercent / 100;
  const sigmaSquared = Math.log(1 + cv * cv);
  return { mu: Math.log(meanValue) - sigmaSquared / 2, sigma: Math.sqrt(sigmaSquared) };
}

/** Fraction of a lognormal population at or below a value. */
export function fractionBelow(shape: LognormalShape, value: number): number {
  if (value <= 0) return 0;
  return normalCdf((Math.log(value) - shape.mu) / shape.sigma);
}

/** Fraction falling in a half-open band, low inclusive and high exclusive. */
export function fractionBetween(
  shape: LognormalShape,
  lowValue: number,
  highValue: number | null,
): number {
  const below = fractionBelow(shape, lowValue);
  const above = highValue === null ? 1 : fractionBelow(shape, highValue);
  const share = above - below;
  return share > 0 ? share : 0;
}

/** The value a given fraction of the population falls below. */
export function quantile(shape: LognormalShape, fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return Number.POSITIVE_INFINITY;

  // Bisection on the CDF. The distribution is monotone, twelve iterations of a
  // doubling bracket plus sixty of bisection is comfortably exact for a weight.
  let low = 0;
  let high = Math.exp(shape.mu) || 1;
  while (fractionBelow(shape, high) < fraction && high < 1e12) high *= 2;

  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (fractionBelow(shape, middle) < fraction) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
