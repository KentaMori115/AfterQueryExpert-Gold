/**
 * The stock history for the demonstration generation.
 *
 * Generated rather than written out, because a cycle is fourteen months of
 * weekly entries across six pens and a hand written version would be both
 * unreadable and quietly inconsistent. Generating it means the weighings
 * actually follow from the temperature the site experienced, so the growth
 * shown on screen is the growth the model would have predicted, which is the
 * only way a demonstration is worth anything.
 *
 * Three things are deliberately not smooth. Pen 5 has a bad February with a
 * winter ulcer outbreak. Pen 7 is emptied into pens 3 and 4 after it, which is
 * what a site actually does. And pen 1 has started harvesting, so it is
 * shrinking while everything else grows.
 */

import { weightAfter } from '@/domain/growth/tgc';
import type { MortalityCause } from '@/domain/health/mortality';
import { groupId } from '@/domain/ids';
import type { StockEvent } from '@/domain/stock/types';
import { accumulate, type TemperatureSample } from '@/domain/time/degreeDays';
import { addWeeks, type Instant } from '@/domain/time/duration';
import { createRandom } from '@/lib/random';

export interface GroupSeed {
  readonly penNumber: number;
  readonly stockedCount: number;
  readonly smoltWeightG: number;
  /** The coefficient this pen actually grew at, which is not the budget. */
  readonly realisedTgc: number;
  /** Baseline weekly mortality as a fraction of the standing count. */
  readonly weeklyMortality: number;
}

export const GROUP_SEEDS: readonly GroupSeed[] = [
  {
    penNumber: 1,
    stockedCount: 72_600,
    smoltWeightG: 118,
    realisedTgc: 3.18,
    weeklyMortality: 0.0012,
  },
  {
    penNumber: 2,
    stockedCount: 71_800,
    smoltWeightG: 121,
    realisedTgc: 3.11,
    weeklyMortality: 0.0014,
  },
  {
    penNumber: 3,
    stockedCount: 70_200,
    smoltWeightG: 114,
    realisedTgc: 3.04,
    weeklyMortality: 0.0016,
  },
  {
    penNumber: 4,
    stockedCount: 71_100,
    smoltWeightG: 116,
    realisedTgc: 3.09,
    weeklyMortality: 0.0015,
  },
  {
    penNumber: 5,
    stockedCount: 69_600,
    smoltWeightG: 109,
    realisedTgc: 2.86,
    weeklyMortality: 0.0021,
  },
  {
    penNumber: 6,
    stockedCount: 72_400,
    smoltWeightG: 120,
    realisedTgc: 3.14,
    weeklyMortality: 0.0013,
  },
  {
    penNumber: 7,
    stockedCount: 68_700,
    smoltWeightG: 107,
    realisedTgc: 2.79,
    weeklyMortality: 0.0028,
  },
];

/** Weeks after stocking that the winter ulcer outbreak runs over. */
export const OUTBREAK_FIRST_WEEK = 41;
export const OUTBREAK_LAST_WEEK = 46;
/** Week pen 7 was emptied into pens 3 and 4. */
export const CONSOLIDATION_WEEK = 47;
/** Week the first harvest of pen 1 went off. */
export const FIRST_HARVEST_WEEK = 54;

/** What the crew write in the note field for each cause. */
export const CAUSE_NOTES: Partial<Record<MortalityCause, string>> = {
  natural: 'Routine mort lift',
  'winter-ulcer': 'Winter ulcer outbreak',
  handling: 'Following handling',
  treatment: 'Following treatment',
};

export function groupReference(penNumber: number): string {
  return `S24-P${penNumber}`;
}

interface BuildOptions {
  readonly stockedAt: Instant;
  readonly weeks: number;
  readonly temperatures: readonly TemperatureSample[];
}

/** Degree-days between two week numbers of the cycle. */
function heatBetween(
  temperatures: readonly TemperatureSample[],
  stockedAt: Instant,
  fromWeek: number,
  toWeek: number,
): number {
  const from = addWeeks(stockedAt, fromWeek);
  const to = addWeeks(stockedAt, toWeek);
  return accumulate(temperatures.filter((sample) => sample.at >= from && sample.at < to));
}

/**
 * Build the event log for one pen.
 *
 * Weighings land every four weeks and carry the weight the pen would actually
 * have reached over the heat since stocking, with a little sampling error on
 * top: a sample of sixty fish out of two hundred thousand does not land exactly
 * on the true mean and pretending it does makes the growth curve look fake.
 */
export function buildGroupEvents(seed: GroupSeed, options: BuildOptions): StockEvent[] {
  const random = createRandom(`stock-p${seed.penNumber}`);
  const id = groupId(`grp-s24-p${seed.penNumber}`);
  const events: StockEvent[] = [];
  let sequence = 0;

  const push = (
    at: Instant,
    kind: StockEvent['kind'],
    countDelta: number,
    meanWeightG: number | null,
    note = '',
  ): void => {
    sequence += 1;
    events.push({
      id: `evt-p${seed.penNumber}-${String(sequence).padStart(4, '0')}`,
      groupId: id,
      at,
      kind,
      countDelta,
      meanWeightG,
      note,
    });
  };

  push(options.stockedAt, 'stocked', seed.stockedCount, seed.smoltWeightG, 'Smolt from Loch Aline');

  let standing = seed.stockedCount;

  for (let week = 1; week <= options.weeks; week += 1) {
    const at = addWeeks(options.stockedAt, week);
    const heat = heatBetween(options.temperatures, options.stockedAt, 0, week);
    const trueWeight = weightAfter(seed.smoltWeightG, heat, seed.realisedTgc);

    const outbreak =
      seed.penNumber === 5 || seed.penNumber === 7
        ? week >= OUTBREAK_FIRST_WEEK && week <= OUTBREAK_LAST_WEEK
        : false;

    const rate = outbreak
      ? seed.weeklyMortality * random.between(9, 16)
      : seed.weeklyMortality * random.between(0.6, 1.6);

    const died = Math.round(standing * rate);
    if (died > 0) {
      // The cause lives in the note because a stock event records a movement
      // rather than a diagnosis; the mortality record carries the cause
      // properly and is reconciled against this by count.
      const cause: MortalityCause = outbreak ? 'winter-ulcer' : 'natural';
      push(at, 'mortality', -died, Math.round(trueWeight), CAUSE_NOTES[cause] ?? '');
      standing -= died;
    }

    if (week % 4 === 0) {
      const sampled = trueWeight * (1 + random.normal(0, 0.011));
      push(at, 'weighed', 0, Math.round(sampled), 'Sample of 60 fish');
    }

    if (seed.penNumber === 7 && week === CONSOLIDATION_WEEK) {
      push(at, 'transferred-out', -standing, Math.round(trueWeight), 'Emptied into pens 3 and 4');
      standing = 0;
    }

    if ((seed.penNumber === 3 || seed.penNumber === 4) && week === CONSOLIDATION_WEEK) {
      // Pen 7's survivors split between the two, which is where they went.
      const taken = Math.round(25_500 * random.between(0.94, 1.06));
      push(at, 'transferred-in', taken, Math.round(trueWeight), 'From pen 7');
      standing += taken;
    }

    if (seed.penNumber === 1 && week >= FIRST_HARVEST_WEEK && week % 2 === 0 && standing > 0) {
      const taken = Math.min(standing, Math.round(15_500 * random.between(0.9, 1.1)));
      push(at, 'harvested', -taken, Math.round(trueWeight), 'Well boat Ronja Kvaloy');
      standing -= taken;
    }
  }

  return events;
}

export function buildAllEvents(options: BuildOptions): StockEvent[] {
  return GROUP_SEEDS.flatMap((seed) => buildGroupEvents(seed, options));
}
