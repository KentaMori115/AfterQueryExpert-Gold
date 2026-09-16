/**
 * Synthetic pen views.
 *
 * The board and the cards care about a handful of fields out of a large
 * projection, and building them out of the fixture dataset means every test
 * that wants an over limit pen has to find one, or invent stock events until
 * one appears. This builds the view directly, so a test that is about ordering
 * reads as a test about ordering.
 *
 * Anything a test does not name gets a healthy value, which is what makes the
 * named part of each case the interesting part.
 */

import type { PenView } from '@/data/projections/pen';
import { planFeed, type Appetite } from '@/domain/feed/plan';
import type { TreatmentEvent } from '@/domain/health/treatment';
import type { PenId, SiteId } from '@/domain/ids';
import { averages, EMPTY_FISH, type FishCount } from '@/domain/lice/counts';
import type { Pen } from '@/domain/site/types';

export const TEST_NOW = Date.UTC(2025, 2, 18, 9, 0);

export interface PenViewOptions {
  readonly number?: number;
  readonly count?: number | null;
  readonly meanWeightG?: number;
  readonly adultFemale?: number | null;
  readonly liceStatus?: PenView['lice']['status'];
  readonly obligation?: boolean;
  readonly weeksOver?: number;
  readonly countedAt?: number | null;
  readonly oxygenBand?: PenView['oxygen']['band'];
  readonly densityKgM3?: number;
  readonly densityStatus?: PenView['densityStatus'];
  readonly mortalityLevel?: PenView['mortalityLevel'];
  readonly withdrawalRemaining?: number | null;
  readonly stockedAt?: number | null;
  readonly degreeDays?: number;
  readonly realisedTgc?: number | null;
  readonly budgetTgc?: number;
  readonly interval?: { readonly lower: number; readonly upper: number } | null;
  readonly sample?: readonly Partial<FishCount>[];
  readonly countedBy?: string;
  readonly note?: string;
  readonly seaTemperatureC?: number | null;
  readonly weekly?: readonly { readonly week: number; readonly adultFemale: number }[];
  readonly temperatureC?: number;
  readonly saturationPercent?: number;
  readonly appetite?: Appetite;
  readonly daysToHandling?: number | null;
  readonly treatments?: readonly Partial<TreatmentEvent>[];
  readonly blocking?: boolean;
}

/** A sample where every fish carries the same load, so the mean is obvious. */
export function evenSample(adultFemale: number, fish = 20): Partial<FishCount>[] {
  return Array.from({ length: fish }, () => ({ adultFemale }));
}

/** The same mean, all of it on two fish, which is what real lice look like. */
export function clusteredSample(total: number, fish = 20): Partial<FishCount>[] {
  return Array.from({ length: fish }, (_, index) => ({
    adultFemale: index < 2 ? total / 2 : 0,
  }));
}

function fullSample(sample: readonly Partial<FishCount>[]): FishCount[] {
  return sample.map((fish) => ({ ...EMPTY_FISH, ...fish }));
}

function pen(number: number): Pen {
  return {
    id: `pen-${number}` as unknown as PenId,
    siteId: 'site-1' as unknown as SiteId,
    number,
    geometry: { circumferenceM: 157, depthM: 22 },
    status: 'stocked',
    netInstalledAt: null,
    notes: '',
  };
}

export function penView(options: PenViewOptions = {}): PenView {
  const count = options.count === undefined ? 60_000 : options.count;
  const meanWeightG = options.meanWeightG ?? 3200;
  const adultFemale = options.adultFemale === undefined ? 0.08 : options.adultFemale;
  const countedAt = options.countedAt === undefined ? TEST_NOW - 2 * 86_400_000 : options.countedAt;
  const temperatureC = options.temperatureC ?? 9.4;
  const saturationPercent = options.saturationPercent ?? 93;
  const biomassKg = count === null ? 0 : (count * meanWeightG) / 1000;

  // A pen said to be blocked must have something blocking it, so asking for
  // the block without naming a treatment gets a medicinal one.
  const givenTreatments =
    options.treatments ??
    (options.blocking === true ? [{ method: 'emamectin-benzoate' as const }] : []);

  const treatments: TreatmentEvent[] = givenTreatments.map((treatment, index) => ({
    id: `treatment-${index}`,
    method: 'thermal',
    completedAt: TEST_NOW - (index + 1) * 21 * 86_400_000,
    penId: `pen-${options.number ?? 1}`,
    beforeCount: null,
    afterCount: null,
    note: '',
    ...treatment,
  }));

  const stockedAt =
    options.stockedAt === undefined ? TEST_NOW - 330 * 86_400_000 : options.stockedAt;
  const budgetTgc = options.budgetTgc ?? 2.9;

  return {
    pen: pen(options.number ?? 1),
    group:
      stockedAt === null
        ? null
        : ({
            id: 'group-1',
            penId: `pen-${options.number ?? 1}`,
            stockedAt,
          } as unknown as PenView['group']),
    generation: {
      code: 'S24',
      budgetTgc,
      strain: 'Aquagen',
      stockedFrom: TEST_NOW,
      plannedHarvestFrom: TEST_NOW,
    } as unknown as PenView['generation'],
    weeksAtSea: 47,
    position:
      count === null
        ? null
        : ({
            count,
            meanWeightG,
            biomassKg: (count * meanWeightG) / 1000,
            stockedCount: 72_000,
            mortalityCount: 1_400,
          } as PenView['position']),
    biomassKg,
    densityKgM3: options.densityKgM3 ?? 12,
    densityStatus: options.densityStatus ?? 'comfortable',
    growth:
      options.degreeDays === undefined && options.realisedTgc === undefined
        ? null
        : {
            degreeDays: options.degreeDays ?? 2_900,
            realisedTgc: options.realisedTgc === undefined ? 2.95 : options.realisedTgc,
            budgetTgc,
            sgrPercent: 0.61,
            aheadOfBudget: (options.realisedTgc ?? 2.95) >= budgetTgc,
          },
    lice: {
      latest:
        adultFemale === null || countedAt === null
          ? null
          : ({
              countedAt,
              countedBy: options.countedBy ?? 'A. Ferguson',
              sample: fullSample(options.sample ?? evenSample(adultFemale)),
              seaTemperatureC:
                options.seaTemperatureC === undefined ? 9.4 : options.seaTemperatureC,
              note: options.note ?? '',
            } as unknown as PenView['lice']['latest']),
      // Averaged out of the sample by the real function, so a test that sets a
      // sample and a test that sets a mean cannot disagree with each other.
      averages:
        adultFemale === null
          ? null
          : averages(fullSample(options.sample ?? evenSample(adultFemale))),
      interval:
        options.interval === undefined
          ? null
          : options.interval === null
            ? null
            : ({
                ...options.interval,
                mean: adultFemale ?? 0,
                standardError: 0.02,
                sampleSize: 20,
              } as PenView['lice']['interval']),
      status: options.liceStatus ?? 'clear',
      obligation: { required: options.obligation ?? false, reason: 'Over limit', daysRemaining: 7 },
      weeksOver: options.weeksOver ?? 0,
      weekly: (options.weekly ?? []).map((entry) => ({
        week: { year: 2025, week: entry.week },
        adultFemale: entry.adultFemale,
      })),
    },
    oxygen: {
      latest: {
        saturationPercent,
        temperatureC,
      } as unknown as PenView['oxygen']['latest'],
      band: options.oxygenBand ?? 'good',
      dayLowPercent: 88,
      readings: [],
    },
    // Planned by the real function rather than stubbed, so a test that pushes
    // the oxygen down gets the ration the barge would actually be given.
    feed:
      count === null
        ? null
        : planFeed({
            biomassKg,
            meanWeightG,
            temperatureC,
            saturationPercent,
            appetite: options.appetite ?? 'normal',
            daysToHandling: options.daysToHandling ?? null,
            operatorCapKg: null,
          }),
    withdrawal:
      options.withdrawalRemaining === undefined || options.withdrawalRemaining === null
        ? null
        : {
            required: 175,
            accumulated: 175 - options.withdrawalRemaining,
            remaining: options.withdrawalRemaining,
            cleared: options.withdrawalRemaining <= 0,
          },
    blocking: options.blocking ? (treatments[0] ?? null) : null,
    treatments,
    cumulativeMortalityPercent: 1.9,
    dailyMortalityPercent: 0.008,
    mortalityLevel: options.mortalityLevel ?? 'normal',
  };
}

export function emptyPen(number: number): PenView {
  return penView({ number, count: null, adultFemale: null, countedAt: null, stockedAt: null });
}
