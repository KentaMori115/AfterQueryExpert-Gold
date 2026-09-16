/**
 * The feed table.
 *
 * Every feed supplier issues one: how much to give, as a percentage of
 * standing biomass per day, for a fish of a given weight in water of a given
 * temperature. Two things fall out of it that are easy to miss.
 *
 * The rate falls as the fish grows, so a pen's daily feed in kilogrammes still
 * climbs steadily even though the percentage is dropping. And the rate peaks
 * around fourteen degrees and comes back down above it, because appetite is
 * limited by oxygen at the warm end rather than by metabolism. A table read as
 * "warmer is always more" overfeeds through a summer bloom, which is both
 * expensive and the surest way to foul the ground under the pen.
 *
 * Between the tabulated points the surface is interpolated in both directions
 * and clamped at the edges. Suppliers publish a grid, not a formula, and
 * inventing a formula that happens to fit their grid is how a site ends up
 * feeding to a curve nobody agreed to.
 */

/** Fish weights the table is tabulated at, grams. */
export const TABLE_WEIGHTS_G = [100, 250, 500, 1_000, 2_000, 4_000, 6_000] as const;

/** Temperatures the table is tabulated at, degrees Celsius. */
export const TABLE_TEMPERATURES_C = [4, 6, 8, 10, 12, 14, 16] as const;

/**
 * Percent of body weight per day. Rows are weights, columns temperatures, in
 * the order of the two arrays above.
 */
export const FEED_RATE_TABLE: readonly (readonly number[])[] = [
  [0.55, 0.85, 1.2, 1.55, 1.85, 2.0, 1.9],
  [0.45, 0.7, 1.0, 1.3, 1.55, 1.7, 1.6],
  [0.38, 0.58, 0.83, 1.08, 1.3, 1.42, 1.34],
  [0.31, 0.48, 0.68, 0.89, 1.07, 1.17, 1.1],
  [0.25, 0.39, 0.55, 0.72, 0.87, 0.95, 0.89],
  [0.2, 0.31, 0.44, 0.58, 0.7, 0.76, 0.71],
  [0.17, 0.27, 0.38, 0.5, 0.6, 0.66, 0.62],
];

interface Bracket {
  readonly low: number;
  readonly high: number;
  /** How far between the two, 0 to 1. */
  readonly fraction: number;
}

/** Index bracket for a value in an ascending axis, clamped at both ends. */
export function bracket(axis: readonly number[], value: number): Bracket {
  const last = axis.length - 1;
  if (value <= axis[0]!) return { low: 0, high: 0, fraction: 0 };
  if (value >= axis[last]!) return { low: last, high: last, fraction: 0 };

  let index = 0;
  while (index < last && axis[index + 1]! < value) index += 1;

  const lowValue = axis[index]!;
  const highValue = axis[index + 1]!;
  return { low: index, high: index + 1, fraction: (value - lowValue) / (highValue - lowValue) };
}

/**
 * Feeding rate for a fish of this weight in water at this temperature, as a
 * percentage of body weight per day.
 */
export function feedRatePercent(weightG: number, temperatureC: number): number {
  const row = bracket([...TABLE_WEIGHTS_G], weightG);
  const column = bracket([...TABLE_TEMPERATURES_C], temperatureC);

  const topLeft = FEED_RATE_TABLE[row.low]![column.low]!;
  const topRight = FEED_RATE_TABLE[row.low]![column.high]!;
  const bottomLeft = FEED_RATE_TABLE[row.high]![column.low]!;
  const bottomRight = FEED_RATE_TABLE[row.high]![column.high]!;

  const top = topLeft + (topRight - topLeft) * column.fraction;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * column.fraction;
  return top + (bottom - top) * row.fraction;
}

/** Kilogrammes to put out today, from the pen's standing biomass. */
export function dailyFeedKg(biomassKg: number, meanWeightG: number, temperatureC: number): number {
  if (biomassKg < 0) {
    throw new RangeError('Standing biomass cannot be negative');
  }
  return (biomassKg * feedRatePercent(meanWeightG, temperatureC)) / 100;
}

/** Pellet diameters a marine site carries, millimetres. */
export const PELLET_SIZES_MM = [3, 4.5, 6, 9, 12] as const;
export type PelletSize = (typeof PELLET_SIZES_MM)[number];

const PELLET_BANDS: readonly { readonly belowG: number; readonly size: PelletSize }[] = [
  { belowG: 150, size: 3 },
  { belowG: 600, size: 4.5 },
  { belowG: 1_500, size: 6 },
  { belowG: 4_000, size: 9 },
  { belowG: Number.POSITIVE_INFINITY, size: 12 },
];

export function pelletSizeFor(weightG: number): PelletSize {
  for (const band of PELLET_BANDS) {
    if (weightG < band.belowG) return band.size;
  }
  return 12;
}

/**
 * Whether the pen is due a pellet change. Worth flagging rather than doing
 * silently, because a size change means a silo change and a barge visit.
 */
export function pelletChangeDue(currentSize: PelletSize, weightG: number): boolean {
  return pelletSizeFor(weightG) !== currentSize;
}

export function formatFeedRate(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return '—';
  return `${percent.toFixed(2)} %/d`;
}
