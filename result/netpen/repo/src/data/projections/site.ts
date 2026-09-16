/**
 * The site projection.
 *
 * Rolls the pens up into the figures the whole site is run against: where the
 * biomass stands against the licence, when the ceiling arrives if nothing is
 * harvested, what the register would show for lice this week, and what the
 * alert list ought to say.
 *
 * The biomass projection is the piece that earns its keep. It walks the growth
 * model forward on the seasonal temperature curve and finds the week the site
 * would go over, which is the number the entire harvest plan is built
 * backwards from. It deliberately assumes no harvest at all: the point is to
 * show what happens if nothing is done.
 */

import {
  merge,
  siteAlerts,
  liceAlerts,
  stockAlerts,
  waterAlerts,
  type DesiredAlert,
} from '@/domain/alerts/rules';
import {
  harvestRequiredT,
  licencePosition,
  weekOfBreach,
  type LicencePosition,
} from '@/domain/biomass/standing';
import { weightAfter } from '@/domain/growth/tgc';
import { siteAverage } from '@/domain/lice/counts';
import { isoWeekOf, MS_PER_WEEK, type Instant } from '@/domain/time/duration';

import type { DataContext } from './context';
import { projectPen, type PenView } from './pen';

/** Fraction of the licence at which the site starts planning a harvest. */
export const NEAR_LICENCE_FRACTION = 0.88;
/** Weeks the biomass projection runs forward. */
export const PROJECTION_WEEKS = 26;
/** Days a site may go between lice counts before it is overdue. */
export const COUNT_INTERVAL_DAYS = 8;

export interface ProjectionPoint {
  readonly weeksAhead: number;
  readonly at: Instant;
  readonly biomassT: number;
  readonly overLimit: boolean;
}

export interface SiteView {
  readonly at: Instant;
  readonly pens: readonly PenView[];
  readonly stocked: readonly PenView[];
  readonly licence: LicencePosition;
  readonly projection: readonly ProjectionPoint[];
  readonly weeksToBreach: number | null;
  readonly harvestRequiredT: readonly number[];
  readonly siteLiceAverage: number | null;
  readonly alerts: readonly DesiredAlert[];
  readonly standingCount: number;
}

export interface SiteViewInput {
  readonly context: DataContext;
  readonly now: Instant;
  /** How far forward the biomass projection runs. */
  readonly weeksAhead?: number;
}

/**
 * Grow every stocked pen forward on the seasonal curve. Mortality is applied
 * at the rate the pen has actually been running at rather than at a budget
 * figure, because a pen with an ulcer problem is not going to stop having one
 * next week.
 */
function projectBiomass(
  context: DataContext,
  pens: readonly PenView[],
  now: Instant,
  weeksAhead: number,
): ProjectionPoint[] {
  const forward = context.forecast.filter((sample) => sample.at >= now);
  const points: ProjectionPoint[] = [];
  const limitT = context.dataset.site.maxBiomassT;

  // Heat accumulated from now to the end of each week. Taking one week's heat
  // and multiplying by the week number is the obvious mistake here and it
  // makes the projection fall away through the autumn instead of climbing.
  let accumulated = 0;

  for (let week = 0; week <= weeksAhead; week += 1) {
    const at = now + week * MS_PER_WEEK;

    if (week > 0) {
      accumulated += forward
        .slice((week - 1) * 7, week * 7)
        .reduce((total, sample) => total + Math.max(0, sample.meanC), 0);
    }

    let biomassKg = 0;
    for (const view of pens) {
      if (view.position === null || view.position.count === 0) continue;
      const survival = (1 - (view.dailyMortalityPercent ?? 0.02) / 100) ** (week * 7);
      const weight = weightAfter(
        view.position.meanWeightG,
        accumulated,
        view.growth?.realisedTgc ?? view.generation.budgetTgc,
      );
      biomassKg += view.position.count * survival * (weight / 1_000);
    }

    const biomassT = biomassKg / 1_000;
    points.push({ weeksAhead: week, at, biomassT, overLimit: biomassT > limitT });
  }

  return points;
}

export function projectSite(input: SiteViewInput): SiteView {
  const { context, now } = input;
  const { dataset } = context;

  const pens = dataset.pens.map((pen) => projectPen({ context, pen, now }));
  const stocked = pens.filter((view) => view.position !== null && view.position.count > 0);

  const licence = licencePosition(
    stocked.map((view) => ({
      penId: String(view.pen.id),
      count: view.position!.count,
      meanWeightG: view.position!.meanWeightG,
      geometry: view.pen.geometry,
    })),
    { siteId: String(dataset.site.id), maxBiomassT: dataset.site.maxBiomassT },
  );

  const projection = projectBiomass(context, stocked, now, input.weeksAhead ?? PROJECTION_WEEKS);
  const breach = weekOfBreach(
    projection.map((point) => point.biomassT),
    { siteId: String(dataset.site.id), maxBiomassT: dataset.site.maxBiomassT },
  );

  const siteLiceAverage = siteAverage(
    stocked.map((view) => ({
      penId: String(view.pen.id),
      adultFemale: view.lice.averages?.adultFemale ?? 0,
      fishCount: view.position!.count,
    })),
  );

  return {
    at: now,
    pens,
    stocked,
    licence,
    projection,
    weeksToBreach: breach,
    harvestRequiredT: harvestRequiredT(
      projection.map((point) => point.biomassT),
      { siteId: String(dataset.site.id), maxBiomassT: dataset.site.maxBiomassT },
    ),
    siteLiceAverage,
    alerts: collectAlerts(context, pens, licence, now),
    standingCount: stocked.reduce((total, view) => total + (view.position?.count ?? 0), 0),
  };
}

function collectAlerts(
  context: DataContext,
  pens: readonly PenView[],
  licence: LicencePosition,
  now: Instant,
): DesiredAlert[] {
  const groups: DesiredAlert[][] = [
    siteAlerts({
      siteId: context.dataset.site.id,
      licence,
      nearFraction: NEAR_LICENCE_FRACTION,
    }),
  ];

  for (const view of pens) {
    if (view.group !== null && view.lice.latest !== null) {
      groups.push(
        liceAlerts({
          groupId: view.group.id,
          penId: view.pen.id,
          regime: context.dataset.site.regime,
          week: isoWeekOf(now),
          adultFemale: view.lice.averages?.adultFemale ?? 0,
          countedAt: view.lice.latest.countedAt,
          now,
          countIntervalDays: COUNT_INTERVAL_DAYS,
          daysToAct: view.lice.obligation.daysRemaining ?? 14,
        }),
      );
    }

    if (view.oxygen.latest !== null) {
      groups.push(
        waterAlerts({
          penId: view.pen.id,
          siteId: context.dataset.site.id,
          saturationPercent: view.oxygen.latest.saturationPercent,
          temperatureC: view.oxygen.latest.temperatureC,
        }),
      );
    }

    if (view.group !== null && view.position !== null && view.position.count > 0) {
      groups.push(
        stockAlerts({
          groupId: view.group.id,
          penId: view.pen.id,
          dailyMortalityPercent: view.dailyMortalityPercent,
          densityKgM3: view.densityKgM3,
          withdrawalRemaining: view.withdrawal?.remaining ?? 0,
          harvestPlanned: view.pen.number === 1,
        }),
      );
    }
  }

  return merge(groups);
}
