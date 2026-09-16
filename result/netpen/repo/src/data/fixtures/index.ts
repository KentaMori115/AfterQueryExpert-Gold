/**
 * Assembling the demonstration dataset.
 *
 * One entry point taking one argument. Everything downstream of `now` is
 * derived, so the demonstration can be pinned to a fixed instant for a
 * screenshot or a test and left floating for the dev server, and it is
 * identical on every machine either way.
 */

import type { TreatmentEvent } from '@/domain/health/treatment';
import { generationId, groupId, penId } from '@/domain/ids';
import type { Pen, Site } from '@/domain/site/types';
import type { Generation, StockEvent, StockGroup } from '@/domain/stock/types';
import type { TemperatureSample } from '@/domain/time/degreeDays';
import { addWeeks, type Instant, MS_PER_DAY, weeksAtSea } from '@/domain/time/duration';

import { buildOxygenSeries, buildProfile, seasonalMeanC, type OxygenReading } from './environment';
import { buildLiceHistory, type LiceCount } from './lice';
import { buildPens, EILEAN_DUBH, PEOPLE, type Person, STOCKED_AT } from './site';
import { buildAllEvents, GROUP_SEEDS, groupReference } from './stock';

export interface Dataset {
  readonly generatedAt: Instant;
  readonly site: Site;
  readonly pens: readonly Pen[];
  readonly people: readonly Person[];
  readonly generation: Generation;
  readonly groups: readonly StockGroup[];
  readonly events: readonly StockEvent[];
  readonly liceCounts: readonly LiceCount[];
  readonly treatments: readonly TreatmentEvent[];
  /** Daily means by logged depth, from stocking up to now. */
  readonly temperatures: ReadonlyMap<number, readonly TemperatureSample[]>;
  /**
   * Daily means forward from now, at the reference depth. Climatological
   * normals rather than a forecast: nobody forecasts sea temperature six
   * months out, and the projection needs something to grow the fish on.
   */
  readonly forecast: readonly TemperatureSample[];
  readonly oxygen: readonly OxygenReading[];
}

/** Depth the feeding and growth decisions are taken against. */
export const REFERENCE_DEPTH_M = 5;
export const SALINITY_PSU = 33.4;
/** How far ahead the normals run, in days. */
export const FORECAST_DAYS = 220;

export function buildDataset(now: Instant): Dataset {
  const weeks = Math.max(1, weeksAtSea(STOCKED_AT, now));
  const days = Math.ceil((now - STOCKED_AT) / MS_PER_DAY) + 1;

  const temperatures = buildProfile(STOCKED_AT, days);
  const reference = temperatures.get(REFERENCE_DEPTH_M) ?? [];

  const generation: Generation = {
    id: generationId('gen-s24'),
    siteId: EILEAN_DUBH.id,
    code: 'S24',
    input: 'spring',
    status: 'harvesting',
    hatchery: 'Loch Aline',
    strain: 'Landcatch',
    firstStockedAt: STOCKED_AT,
    lastHarvestedAt: null,
    budgetTgc: 3.1,
    budgetFcr: 1.15,
    notes: 'Single year class. Fallow booked for six weeks after the last lift.',
  };

  const groups: StockGroup[] = GROUP_SEEDS.map((seed) => ({
    id: groupId(`grp-s24-p${seed.penNumber}`),
    generationId: generation.id,
    penId: penId(`pen-${seed.penNumber}`),
    reference: groupReference(seed.penNumber),
    stockedAt: STOCKED_AT,
    closedAt: seed.penNumber === 7 ? addWeeks(STOCKED_AT, 47) : null,
    notes: seed.penNumber === 7 ? 'Emptied into pens 3 and 4' : '',
  }));

  const meanAt = (at: Instant): number => seasonalMeanC(at, REFERENCE_DEPTH_M);

  const lice = buildLiceHistory({
    penNumbers: GROUP_SEEDS.map((seed) => seed.penNumber),
    stockedAt: STOCKED_AT,
    weeks,
    regime: EILEAN_DUBH.regime,
    temperatureAt: meanAt,
  });

  // Oxygen is only kept for the last quarter. A reading every six hours for
  // fourteen months across six pens is a quarter of a million rows and nobody
  // looks further back than the season they are in.
  const oxygenDays = Math.min(days, 92);
  const oxygenFrom = now - oxygenDays * MS_PER_DAY;
  const oxygen = GROUP_SEEDS.filter((seed) => seed.penNumber !== 7).flatMap((seed) =>
    buildOxygenSeries({
      penId: `pen-${seed.penNumber}`,
      from: oxygenFrom,
      days: oxygenDays,
      temperatures: reference,
      salinityPsu: SALINITY_PSU,
    }),
  );

  return {
    generatedAt: now,
    site: EILEAN_DUBH,
    pens: buildPens(now),
    people: PEOPLE,
    generation,
    groups,
    events: buildAllEvents({ stockedAt: STOCKED_AT, weeks, temperatures: reference }),
    liceCounts: lice.counts,
    treatments: lice.treatments,
    temperatures,
    forecast: Array.from({ length: FORECAST_DAYS }, (_unused, day) => {
      const at = now + day * MS_PER_DAY;
      return { at, meanC: Number(seasonalMeanC(at, REFERENCE_DEPTH_M).toFixed(2)) };
    }),
    oxygen,
  };
}

export interface DatasetShape {
  readonly pens: number;
  readonly groups: number;
  readonly events: number;
  readonly liceCounts: number;
  readonly treatments: number;
  readonly temperatureDays: number;
  readonly forecastDays: number;
  readonly oxygenReadings: number;
  readonly weeks: number;
}

export function describeDataset(dataset: Dataset): DatasetShape {
  return {
    pens: dataset.pens.length,
    groups: dataset.groups.length,
    events: dataset.events.length,
    liceCounts: dataset.liceCounts.length,
    treatments: dataset.treatments.length,
    temperatureDays: dataset.temperatures.get(REFERENCE_DEPTH_M)?.length ?? 0,
    forecastDays: dataset.forecast.length,
    oxygenReadings: dataset.oxygen.length,
    weeks: weeksAtSea(STOCKED_AT, dataset.generatedAt),
  };
}

export { EILEAN_DUBH, PEOPLE, STOCKED_AT };
export type { OxygenReading, Person, LiceCount };
