/**
 * The pen projection.
 *
 * One function that takes a pen and produces everything the board row and the
 * detail page need. It is the single place the domain modules are wired
 * together, which is what keeps the screens free of engineering: a change to
 * how the withdrawal is judged, or to which constraint binds the feed, lands
 * here and nowhere else.
 *
 * Nothing in it reads the clock. The instant comes in, and every figure is
 * derived against it, so a page pinned to last Tuesday shows what the site
 * looked like last Tuesday rather than a mixture.
 */

import { densityStatus, penDensityKgM3, type DensityStatus } from '@/domain/biomass/standing';
import { type Appetite, planFeed, type FeedPlan } from '@/domain/feed/plan';
import { specificGrowthRate } from '@/domain/growth/condition';
import { fitTgc } from '@/domain/growth/tgc';
import { levelFor, type MortalityLevel } from '@/domain/health/mortality';
import {
  blockingTreatment,
  withdrawalStatus,
  type TreatmentEvent,
  type WithdrawalStatus,
} from '@/domain/health/treatment';
import {
  averages,
  intervalFor,
  type CountInterval,
  type StageAverages,
} from '@/domain/lice/counts';
import {
  consecutiveWeeksOver,
  statusFor,
  treatmentObligation,
  type LiceStatus,
  type TreatmentObligation,
  type WeeklyCount,
} from '@/domain/lice/thresholds';
import type { Pen } from '@/domain/site/types';
import { positionAt, type StockPosition } from '@/domain/stock/ledger';
import type { Generation, StockGroup } from '@/domain/stock/types';
import { accumulate } from '@/domain/time/degreeDays';
import { addDays, isoWeekOf, type Instant, weeksAtSea } from '@/domain/time/duration';
import { oxygenBand, type OxygenBand } from '@/domain/water/oxygen';

import type { LiceCount, OxygenReading } from '../fixtures';
import { eventsFor, latestCount, openGroupIn, oxygenBetween, type DataContext } from './context';

export interface LiceView {
  readonly latest: LiceCount | null;
  readonly averages: StageAverages | null;
  readonly interval: CountInterval | null;
  readonly status: LiceStatus;
  readonly obligation: TreatmentObligation;
  readonly weeksOver: number;
  readonly weekly: readonly WeeklyCount[];
}

export interface OxygenView {
  readonly latest: OxygenReading | null;
  readonly band: OxygenBand;
  /** Lowest saturation in the last day, which is what actually bit. */
  readonly dayLowPercent: number | null;
  readonly readings: readonly OxygenReading[];
}

export interface GrowthView {
  readonly degreeDays: number;
  readonly realisedTgc: number | null;
  readonly budgetTgc: number;
  readonly sgrPercent: number | null;
  readonly aheadOfBudget: boolean | null;
}

export interface PenView {
  readonly pen: Pen;
  readonly group: StockGroup | null;
  readonly generation: Generation;
  readonly weeksAtSea: number | null;
  readonly position: StockPosition | null;
  readonly biomassKg: number;
  readonly densityKgM3: number;
  readonly densityStatus: DensityStatus;
  readonly growth: GrowthView | null;
  readonly lice: LiceView;
  readonly oxygen: OxygenView;
  readonly feed: FeedPlan | null;
  readonly withdrawal: WithdrawalStatus | null;
  readonly blocking: TreatmentEvent | null;
  readonly treatments: readonly TreatmentEvent[];
  readonly cumulativeMortalityPercent: number | null;
  readonly dailyMortalityPercent: number | null;
  readonly mortalityLevel: MortalityLevel;
}

export interface PenViewInput {
  readonly context: DataContext;
  readonly pen: Pen;
  readonly now: Instant;
  /** Observed appetite, which only the crew can supply. */
  readonly appetite?: Appetite;
  /** Days until this pen is crowded, where something is booked. */
  readonly daysToHandling?: number | null;
}

/** Weekly adult female figures, which is what the threshold rules read. */
function weeklySeries(counts: readonly LiceCount[]): WeeklyCount[] {
  return counts
    .slice()
    .sort((a, b) => a.countedAt - b.countedAt)
    .map((count) => ({
      week: isoWeekOf(count.countedAt),
      adultFemale: averages(count.sample)?.adultFemale ?? 0,
    }));
}

export function projectPen(input: PenViewInput): PenView {
  const { context, pen, now } = input;
  const { dataset } = context;
  const group = openGroupIn(context, String(pen.id), now);

  const options = { tgc: dataset.generation.budgetTgc, temperatures: context.reference };
  const position =
    group === null ? null : positionAt(eventsFor(context, String(group.id)), now, options);

  const biomassKg = position === null ? 0 : position.biomassKg;
  const density =
    position === null
      ? 0
      : penDensityKgM3({
          penId: String(pen.id),
          count: position.count,
          meanWeightG: position.meanWeightG,
          geometry: pen.geometry,
        });

  const counts = group === null ? [] : (context.liceByGroup.get(String(group.id)) ?? []);
  const upToNow = counts.filter((count) => count.countedAt <= now);
  const latest = group === null ? null : latestCount(context, String(group.id), now);
  const weekly = weeklySeries(upToNow);
  const currentWeek = isoWeekOf(now);
  const adultFemale = weekly.length === 0 ? 0 : weekly[weekly.length - 1]!.adultFemale;

  const treatments = (context.treatmentsByPen.get(String(pen.id)) ?? [])
    .filter((treatment) => treatment.completedAt <= now)
    .sort((a, b) => b.completedAt - a.completedAt);

  const blocking = blockingTreatment(treatments, context.reference);
  const withdrawal = treatments[0] ? withdrawalStatus(treatments[0], context.reference) : null;

  const dayReadings = oxygenBetween(context, String(pen.id), addDays(now, -1), now);
  const allReadings = oxygenBetween(context, String(pen.id), addDays(now, -14), now);
  const latestReading = allReadings[allReadings.length - 1] ?? null;
  const dayLowPercent =
    dayReadings.length === 0 ? null : Math.min(...dayReadings.map((r) => r.saturationPercent));

  const growth = buildGrowth(context, group, position, now);
  const mortality = buildMortality(
    position,
    group === null ? null : eventsFor(context, String(group.id)),
    now,
  );

  return {
    pen,
    group,
    generation: dataset.generation,
    weeksAtSea: group === null ? null : weeksAtSea(group.stockedAt, now),
    position,
    biomassKg,
    densityKgM3: density,
    densityStatus: densityStatus(density),
    growth,
    lice: {
      latest,
      averages: latest === null ? null : averages(latest.sample),
      interval: latest === null ? null : intervalFor(latest.sample, 'adultFemale'),
      status: statusFor(dataset.site.regime, currentWeek, adultFemale),
      obligation: treatmentObligation(weekly, dataset.site.regime),
      weeksOver: consecutiveWeeksOver(weekly, dataset.site.regime),
      weekly,
    },
    oxygen: {
      latest: latestReading,
      band: oxygenBand(latestReading?.saturationPercent ?? Number.NaN),
      dayLowPercent,
      readings: allReadings,
    },
    feed:
      position === null || position.count === 0 || latestReading === null
        ? null
        : planFeed({
            biomassKg,
            meanWeightG: position.meanWeightG,
            temperatureC: latestReading.temperatureC,
            saturationPercent: latestReading.saturationPercent,
            appetite: input.appetite ?? 'normal',
            daysToHandling: input.daysToHandling ?? null,
            operatorCapKg: null,
          }),
    withdrawal,
    blocking,
    treatments,
    ...mortality,
  };
}

function buildGrowth(
  context: DataContext,
  group: StockGroup | null,
  position: StockPosition | null,
  now: Instant,
): GrowthView | null {
  if (group === null || position === null || position.count === 0) return null;

  const events = eventsFor(context, String(group.id));
  const stocked = events.find((event) => event.kind === 'stocked');
  const startWeight = stocked?.meanWeightG ?? null;

  const degreeDays = accumulate(
    context.reference.filter((sample) => sample.at >= group.stockedAt && sample.at < now),
  );

  const realisedTgc =
    startWeight === null || degreeDays <= 0
      ? null
      : fitTgc(startWeight, position.meanWeightG, degreeDays);

  const days = (now - group.stockedAt) / 86_400_000;
  const sgrPercent =
    startWeight === null || days <= 0
      ? null
      : specificGrowthRate(startWeight, position.meanWeightG, days);

  const budgetTgc = context.dataset.generation.budgetTgc;

  return {
    degreeDays,
    realisedTgc,
    budgetTgc,
    sgrPercent,
    aheadOfBudget: realisedTgc === null ? null : realisedTgc >= budgetTgc,
  };
}

function buildMortality(
  position: StockPosition | null,
  events: ReturnType<typeof eventsFor> | null,
  now: Instant,
): Pick<PenView, 'cumulativeMortalityPercent' | 'dailyMortalityPercent' | 'mortalityLevel'> {
  if (position === null || events === null || position.stockedCount === 0) {
    return {
      cumulativeMortalityPercent: null,
      dailyMortalityPercent: null,
      mortalityLevel: 'unknown',
    };
  }

  const cumulative = (position.mortalityCount / position.stockedCount) * 100;

  const from = addDays(now, -7);
  const recent = events
    .filter((event) => event.kind === 'mortality' && event.at >= from && event.at <= now)
    .reduce((total, event) => total + -event.countDelta, 0);

  const standing = position.count + recent;
  const daily = standing > 0 ? (recent / standing / 7) * 100 : null;

  return {
    cumulativeMortalityPercent: cumulative,
    dailyMortalityPercent: daily,
    mortalityLevel: levelFor(daily),
  };
}
