/**
 * Chart theming and axis arithmetic.
 *
 * The charts are hand drawn as SVG rather than handed to a library. Three of
 * the four are unusual enough that a general purpose library would be fought
 * rather than used: a lice chart wants a threshold line that moves with the
 * calendar, a biomass chart wants a licence ceiling with the overshoot shaded,
 * and an oxygen chart wants a band rather than a line. The fourth is a plain
 * multi-series trace, and having it share the same axis code as the others is
 * worth more than the few lines a library would have saved.
 *
 * Series colours are chosen to survive two things: a barge screen in daylight,
 * and being printed in grey scale for the weekly file. Every series therefore
 * differs in dash pattern as well as in hue.
 */

export const SERIES_COLOURS = {
  temperature: '#275d5a',
  temperatureDeep: '#93b6d8',
  oxygen: '#2f5c86',
  oxygenLow: '#c2453c',
  adultFemale: '#c2453c',
  mobile: '#f08a2c',
  chalimus: '#7f8f4a',
  biomass: '#367b77',
  budget: '#8a9898',
  licence: '#9d3229',
  harvest: '#57642c',
  grid: '#d2dada',
  axis: '#667474',
} as const;

export type SeriesKey = keyof typeof SERIES_COLOURS;

/** Dash patterns, so the series stay apart in grey scale. */
export const SERIES_DASH: Partial<Record<SeriesKey, string>> = {
  temperatureDeep: '5 3',
  mobile: '4 3',
  chalimus: '2 3',
  budget: '6 4',
  licence: '7 4',
  oxygenLow: '3 3',
};

export interface Margin {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 10, right: 14, bottom: 26, left: 44 };

export interface Extent {
  readonly min: number;
  readonly max: number;
}

/**
 * Extent of a set of values, ignoring anything not finite. Returns null for an
 * empty set rather than the infinities a reduce would leave behind.
 */
export function extentOf(values: readonly number[]): Extent | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let seen = false;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    seen = true;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return seen ? { min, max } : null;
}

/**
 * Pad an extent out to round numbers so the axis labels are readable, and make
 * sure a flat series still gets a visible band rather than a zero height one.
 */
export function niceExtent(extent: Extent | null, fallback: Extent): Extent {
  if (extent === null) return fallback;

  const span = extent.max - extent.min;
  if (span <= 0) {
    const pad = Math.max(1, Math.abs(extent.max) * 0.1);
    return { min: extent.min - pad, max: extent.max + pad };
  }

  const step = niceStep(span / 4);
  return {
    min: Math.floor(extent.min / step) * step,
    max: Math.ceil(extent.max / step) * step,
  };
}

/** The nearest 1, 2 or 5 times a power of ten, which is what people read. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  if (normalised <= 1) return magnitude;
  if (normalised <= 2) return 2 * magnitude;
  if (normalised <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function ticksAtStep(extent: Extent, step: number): number[] {
  const ticks: number[] = [];
  for (
    let value = Math.ceil(extent.min / step) * step;
    value <= extent.max + step * 1e-9;
    value += step
  ) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Fewer than this on an axis and the reader is interpolating by eye. */
export const MINIMUM_TICKS = 3;

/**
 * Tick values across an extent, at readable intervals.
 *
 * The obvious implementation - round the span over the tick count to a nice
 * step and walk it - undershoots badly on an extent that does not start on a
 * round number. A span of 3.2 to 14.7 asks for a step of about 2.3, rounds it
 * to 5, and then only two ticks fall inside the range. So the step comes down
 * the one-two-five ladder until enough of them land.
 */
export function ticksFor(extent: Extent, count = 5): number[] {
  let step = niceStep((extent.max - extent.min) / Math.max(1, count));
  let ticks = ticksAtStep(extent, step);

  for (let attempt = 0; attempt < 3 && ticks.length < MINIMUM_TICKS; attempt += 1) {
    step = finerStep(step);
    ticks = ticksAtStep(extent, step);
  }

  return ticks;
}

/** The next step down the one-two-five ladder. */
export function finerStep(step: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const normalised = Number((step / magnitude).toFixed(6));
  if (normalised > 5) return 5 * magnitude;
  if (normalised > 2) return 2 * magnitude;
  if (normalised > 1) return magnitude;
  return 5 * (magnitude / 10);
}

/** Linear map from a data extent onto a pixel range. */
export function scaleLinear(extent: Extent, from: number, to: number): (value: number) => number {
  const span = extent.max - extent.min;
  if (span === 0) return () => (from + to) / 2;
  return (value) => from + ((value - extent.min) / span) * (to - from);
}

/**
 * Week ticks across a cycle. A cycle runs sixty odd weeks and labelling every
 * one is unreadable, so the spacing widens with the span the way somebody
 * reading a production plan would expect.
 */
export function weekTickStep(weeks: number): number {
  if (weeks <= 12) return 2;
  if (weeks <= 30) return 4;
  if (weeks <= 60) return 8;
  return 13;
}

export function formatWeekTick(week: number): string {
  return `w${Math.round(week)}`;
}
