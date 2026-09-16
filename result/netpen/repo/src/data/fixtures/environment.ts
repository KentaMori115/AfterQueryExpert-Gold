/**
 * Sea temperature and oxygen for the demonstration site.
 *
 * Temperature is generated from a seasonal curve rather than a table, because
 * a cycle runs eighteen months and a table of five hundred and fifty daily
 * means at five depths is unreadable and unmaintainable. The curve is fitted
 * to the west coast: a mean around eleven degrees, four degrees either side of
 * it, warmest in the third week of August and coldest in the third week of
 * February, with the deeper water lagging the surface by a fortnight and
 * swinging less.
 *
 * Oxygen is derived rather than invented. Saturation is generated, and the
 * concentration follows from the temperature and salinity through the same
 * solubility the rest of the application uses, so the demonstration data
 * cannot disagree with the science it is displayed against.
 */

import type { TemperatureSample } from '@/domain/time/degreeDays';
import { addDays, type Instant, MS_PER_DAY } from '@/domain/time/duration';
import { LOGGED_DEPTHS_M } from '@/domain/units/water';
import { concentrationForSaturation } from '@/domain/water/oxygen';
import { createRandom } from '@/lib/random';

/** Annual mean at the reference depth, degrees Celsius. */
export const ANNUAL_MEAN_C = 11;
/** Half the annual swing, degrees. */
export const ANNUAL_AMPLITUDE_C = 4;
/** Day of year the surface is warmest. Third week of August. */
export const WARMEST_DAY_OF_YEAR = 231;

function dayOfYear(instant: Instant): number {
  const date = new Date(instant);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((instant - start) / MS_PER_DAY) + 1;
}

/**
 * Seasonal mean at a depth. Deeper water lags and swings less, which is what
 * puts a thermocline over the pens through the summer and takes it away again
 * in the autumn gales.
 */
export function seasonalMeanC(instant: Instant, depthM: number): number {
  const lagDays = depthM * 1.2;
  const damping = 1 / (1 + depthM * 0.035);
  const phase =
    (2 * Math.PI * (dayOfYear(instant) - WARMEST_DAY_OF_YEAR - lagDays + 91.25)) / 365.25;
  return ANNUAL_MEAN_C + ANNUAL_AMPLITUDE_C * damping * Math.sin(phase);
}

export interface SeriesOptions {
  readonly from: Instant;
  readonly days: number;
  readonly depthM: number;
  readonly seed?: string;
}

/**
 * Daily means with weather on top of the season. The noise is autocorrelated:
 * a cold week is a cold week, not seven independent cold days, and a series of
 * independent draws produces a jagged trace nobody would believe.
 */
export function buildTemperatureSeries(options: SeriesOptions): TemperatureSample[] {
  const random = createRandom(options.seed ?? `temp-${options.depthM}`);
  const samples: TemperatureSample[] = [];
  let weather = 0;

  for (let day = 0; day < options.days; day += 1) {
    const at = addDays(options.from, day);
    // A first order walk with a pull back toward zero, so excursions decay.
    weather = weather * 0.86 + random.normal(0, 0.28);
    const meanC = seasonalMeanC(at, options.depthM) + weather;
    samples.push({ at, meanC: Number(meanC.toFixed(2)) });
  }

  return samples;
}

export interface OxygenReading {
  readonly penId: string;
  readonly at: Instant;
  readonly depthM: number;
  readonly temperatureC: number;
  readonly salinityPsu: number;
  readonly oxygenMgL: number;
  readonly saturationPercent: number;
}

/**
 * Saturation through a day. It falls through the afternoon as the fish digest
 * and the tide slackens, and recovers overnight, which is why a single spot
 * reading at nine in the morning tells nobody very much.
 */
export function saturationAt(hourOfDay: number, base: number, dip: number): number {
  const phase = (2 * Math.PI * (hourOfDay - 4)) / 24;
  return base - dip * Math.max(0, Math.sin(phase));
}

export interface OxygenOptions {
  readonly penId: string;
  readonly from: Instant;
  readonly days: number;
  readonly temperatures: readonly TemperatureSample[];
  readonly salinityPsu: number;
  /** Readings a day. Four is the usual: dawn, midday, afternoon, dusk. */
  readonly perDay?: number;
  readonly seed?: string;
}

export function buildOxygenSeries(options: OxygenOptions): OxygenReading[] {
  const random = createRandom(options.seed ?? `oxy-${options.penId}`);
  const perDay = options.perDay ?? 4;
  const readings: OxygenReading[] = [];
  const byDay = new Map(options.temperatures.map((sample) => [sample.at, sample.meanC]));

  for (let day = 0; day < options.days; day += 1) {
    const midnight = addDays(options.from, day);
    const temperatureC = byDay.get(midnight) ?? seasonalMeanC(midnight, 5);

    // Warmer water holds less and the fish want more of it, so the daily dip
    // deepens through the summer. This is what makes August the hard month.
    const base = 98 - Math.max(0, temperatureC - 10) * 1.9 + random.normal(0, 1.4);
    const dip = 8 + Math.max(0, temperatureC - 10) * 3.1 + random.normal(0, 1.1);

    for (let slot = 0; slot < perDay; slot += 1) {
      const hourOfDay = 6 + (slot * 14) / Math.max(1, perDay - 1);
      const saturationPercent = Math.max(
        20,
        Math.min(125, saturationAt(hourOfDay, base, dip) + random.normal(0, 0.9)),
      );

      readings.push({
        penId: options.penId,
        at: midnight + hourOfDay * 3_600_000,
        depthM: 5,
        temperatureC: Number(temperatureC.toFixed(2)),
        salinityPsu: options.salinityPsu,
        oxygenMgL: Number(
          concentrationForSaturation(saturationPercent, temperatureC, options.salinityPsu).toFixed(
            2,
          ),
        ),
        saturationPercent: Number(saturationPercent.toFixed(1)),
      });
    }
  }

  return readings;
}

/** Series at every logged depth, which is what the profile view needs. */
export function buildProfile(from: Instant, days: number): Map<number, TemperatureSample[]> {
  const byDepth = new Map<number, TemperatureSample[]>();
  for (const depthM of LOGGED_DEPTHS_M) {
    byDepth.set(depthM, buildTemperatureSeries({ from, days, depthM }));
  }
  return byDepth;
}
