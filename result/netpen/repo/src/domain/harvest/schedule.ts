/**
 * The harvest plan.
 *
 * Standing biomass says the ceiling arrives; this says what to do about it.
 * A plan is a set of lifts, one pen to a week, and the site wants the cheapest
 * set that keeps every week of the horizon legal. Cheapest is three things in
 * order: fewest pens, because every lift is a boat and a crew and a day the
 * rest of the site is not being fed; then the latest lifts, because a week in
 * the water is a week of growth and a site that empties itself early to be
 * safe has given away the margin it was farming for; then the lower pen
 * numbers, so the same site never gets two different plans.
 *
 * What makes that harder than it sounds is that the same pen is three
 * different figures at once. The licence counts it live. The boat lands it
 * gutted, and the yield is the pen's own condition rather than a constant, so
 * two pens at the same live tonnage do not fill the same share of a week. The
 * contract reads gutted weight too, which is why a deep-conditioned pen can
 * pass a live mean and still be refused. On top of that the withdrawal on a
 * medicine runs in degree-days, and the boat's week is shared: what one pen
 * lands is room another pen no longer has. Those interact, and a pen pushed
 * out of the week it wanted lands earlier and lighter, which changes what
 * stands in every week after it. So the sets have to be weighed against each
 * other rather than assembled a pen at a time.
 *
 * A pen whose log will not validate is left out of all of it, biomass
 * included. That is the uncomfortable one: dropping a pen makes the site look
 * lighter and can hide a breach. It is still right, because the alternative is
 * a licence total holding a figure the ledger itself will not stand behind,
 * and a plan is read by people who would not know which pen it came from.
 *
 * A plan that cannot be made is reported rather than approximated. A site that
 * will breach in week six with nothing liftable before it has a problem no
 * arithmetic solves, and the useful output is the week and the tonnage, not a
 * schedule that quietly leaves the site over its licence.
 */

import { bookedTonnes, fits, openSlots, reserve } from './capacity';
import { isReady } from './eligibility';
import {
  isPlannable,
  projectPens,
  type HarvestHorizon,
  type HarvestPen,
  type PenWeek,
} from './forecast';
import { weekOfBreach } from '../biomass/standing';
import type { PenId } from '../ids';
import type { TemperatureSample } from '../time/degreeDays';
import type { Instant } from '../time/duration';

export interface HarvestRequest {
  /** The instant the plan is drawn on. */
  readonly at: Instant;
  /** Maximum allowed biomass on the licence, tonnes. */
  readonly maxBiomassT: number;
  /** Tonnes the boat will take in each week of the horizon. */
  readonly weeklyCapacityT: readonly number[];
  /** Mean live weight the contract will not take a pen below. */
  readonly minHarvestWeightG: number;
  /** Daily means covering the record and the forecast. */
  readonly temperatures: readonly TemperatureSample[];
  readonly pens: readonly HarvestPen[];
}

export interface HarvestBooking {
  readonly penId: PenId;
  readonly week: number;
  /** Live tonnes the pen carries in the week it goes, which is the licence figure. */
  readonly tonnes: number;
  /** Gutted tonnes the boat lands, which is what the slot was measured against. */
  readonly guttedT: number;
  readonly meanWeightG: number;
}

export interface HarvestShortfall {
  readonly week: number;
  /** Tonnes the site is over its licence in that week with nothing left to book. */
  readonly excessT: number;
}

export interface HarvestPlan {
  readonly bookings: readonly HarvestBooking[];
  /** Site biomass at the end of each week once the bookings are taken out. */
  readonly weeklyBiomassT: readonly number[];
  readonly shortfall: HarvestShortfall | null;
  /** Pens left out because their log will not validate, by grid number. */
  readonly skipped: readonly PenId[];
}

/** A pen lifted in a week, while a plan is still being weighed up. */
type Lift = { readonly pen: HarvestPen; readonly week: number };

function horizonOf(request: HarvestRequest): HarvestHorizon {
  return {
    at: request.at,
    weeks: request.weeklyCapacityT.length,
    temperatures: request.temperatures,
  };
}

/**
 * Site biomass week by week under a set of lifts.
 *
 * A pen lifted in week w is still in the water for that week and gone from the
 * week after: the boat comes at the end of the week it is booked into, so the
 * fish are there to be counted against the licence right up to the lift.
 */
export function siteBiomassByWeek(
  pens: readonly HarvestPen[],
  horizon: HarvestHorizon,
  lifts: readonly Lift[],
  outlooks?: ReadonlyMap<PenId, PenWeek[]>,
): number[] {
  const projected = outlooks ?? projectPens(pens, horizon);
  const booked = new Map(lifts.map((lift) => [lift.pen.penId, lift.week]));
  const totals: number[] = [];

  for (let week = 0; week < horizon.weeks; week += 1) {
    let standing = 0;

    for (const pen of pens) {
      const lifted = booked.get(pen.penId);
      if (lifted !== undefined && week > lifted) continue;
      standing += projected.get(pen.penId)?.[week]?.biomassT ?? 0;
    }

    totals.push(standing);
  }

  return totals;
}

/** Weeks a pen could go in at all, before anything else is booked. */
function openTo(
  request: HarvestRequest,
  horizon: HarvestHorizon,
  pen: HarvestPen,
  projection: readonly PenWeek[],
): number[] {
  const weeks: number[] = [];

  for (const outlook of projection) {
    if (!isReady(pen, horizon, outlook, request.minHarvestWeightG)) continue;
    if (!fits(openSlots(request.weeklyCapacityT), outlook.week, outlook.guttedT)) continue;
    weeks.push(outlook.week);
  }

  return weeks;
}

/**
 * Which of two plans a site would rather have.
 *
 * Fewest pens first, because every lift is a boat, a crew and a day the rest
 * of the site is not being fed. Then the latest, because a pen left one more
 * week is a pen worth more, and a site that empties itself early to be safe
 * has given away the margin it was farming for. Pen numbers settle what is
 * left, and they have to, because a week takes more than one pen: two plans
 * can lift the same pens in the same weeks and still differ over which pen got
 * the later week. So the lifts are read as pairs, latest first and the lower
 * number ahead within a week, rather than as two separate lists. Without that
 * last step the plan a site gets would depend on the order its pens arrived in.
 */
function ordered(lifts: readonly Lift[]): Lift[] {
  return lifts.slice().sort((a, b) => b.week - a.week || a.pen.number - b.pen.number);
}

function isBetter(left: readonly Lift[], right: readonly Lift[]): boolean {
  if (left.length !== right.length) return left.length < right.length;

  const leftOrder = ordered(left);
  const rightOrder = ordered(right);

  for (let index = 0; index < leftOrder.length; index += 1) {
    const here = leftOrder[index]!;
    const there = rightOrder[index]!;
    if (here.week !== there.week) return here.week > there.week;
    if (here.pen.number !== there.pen.number) return here.pen.number < there.pen.number;
  }

  return false;
}

/**
 * Whether a set of lifts stays inside what the boat will land, week by week.
 *
 * A week is not one pen. The boat comes once and takes whatever the site can
 * get under its figure, so two pens can share a week while what they land
 * together fits and a single pen that has outgrown the figure cannot go at all.
 * That is why capacity has to be checked over the whole set rather than pen by
 * pen: a pair that each fit on their own may not fit together, and a pen
 * pushed out of a shared week lands earlier and lighter, which changes what
 * stands in every week after it.
 */
function boatHolds(
  request: HarvestRequest,
  lifts: readonly Lift[],
  outlooks: ReadonlyMap<PenId, PenWeek[]>,
): boolean {
  let ledger = openSlots(request.weeklyCapacityT);

  for (const lift of lifts) {
    const landed = outlooks.get(lift.pen.penId)?.[lift.week]?.guttedT ?? 0;
    if (!fits(ledger, lift.week, landed)) return false;
    ledger = reserve(ledger, lift.week, lift.pen.penId, landed);
  }

  return true;
}

/**
 * Search every set of lifts the site could book, and keep the best one that
 * holds the licence and the boat together.
 *
 * Walked exhaustively rather than chosen greedily, and the difference is not
 * academic. Taking the heaviest pen that clears the week in front of you is
 * the obvious move and it is regularly wrong: that pen may fill the week a
 * later breach needs, and a lighter pen taken now would have left room for
 * both. Sets are tried smallest first so the first plan that holds is already
 * the shortest, and the comparison above settles the rest.
 */
function search(
  request: HarvestRequest,
  horizon: HarvestHorizon,
  pens: readonly HarvestPen[],
  outlooks: ReadonlyMap<PenId, PenWeek[]>,
): Lift[] | null {
  const licence = { siteId: '', maxBiomassT: request.maxBiomassT };
  const openings = new Map(
    pens.map((pen) => [pen.penId, openTo(request, horizon, pen, outlooks.get(pen.penId) ?? [])]),
  );

  let best: Lift[] | null = null;

  const walk = (index: number, taken: Lift[], size: number): void => {
    if (taken.length === size) {
      if (!boatHolds(request, taken, outlooks)) return;
      if (weekOfBreach(siteBiomassByWeek(pens, horizon, taken, outlooks), licence) !== null) return;
      if (best === null || isBetter(taken, best)) best = [...taken];
      return;
    }
    if (index >= pens.length) return;
    if (pens.length - index < size - taken.length) return;

    const pen = pens[index]!;
    for (const week of openings.get(pen.penId) ?? []) {
      taken.push({ pen, week });
      walk(index + 1, taken, size);
      taken.pop();
    }

    walk(index + 1, taken, size);
  };

  for (let size = 0; size <= pens.length; size += 1) {
    walk(0, [], size);
    if (best !== null) return best;
  }

  return null;
}

/**
 * The plan a site should book, or the week it cannot cover.
 *
 * Nothing is booked at all where no set of lifts holds the licence. A site
 * that will breach in week six with nothing liftable before it has a problem
 * no arithmetic solves, and a half plan that still ends in breach is worse
 * than none: it reads as though the ceiling had been dealt with.
 */
export function planHarvest(request: HarvestRequest): HarvestPlan {
  const horizon = horizonOf(request);
  const planned = request.pens.filter(isPlannable);
  const skipped = request.pens
    .filter((pen) => !isPlannable(pen))
    .sort((a, b) => a.number - b.number)
    .map((pen) => pen.penId);

  const outlooks = projectPens(planned, horizon);
  const licence = { siteId: '', maxBiomassT: request.maxBiomassT };
  const lifts = search(request, horizon, planned, outlooks);

  if (lifts === null) {
    const weekly = siteBiomassByWeek(planned, horizon, [], outlooks);
    const week = weekOfBreach(weekly, licence) ?? 0;
    return {
      bookings: [],
      weeklyBiomassT: weekly,
      shortfall: { week, excessT: weekly[week]! - request.maxBiomassT },
      skipped,
    };
  }

  const bookings = lifts
    .map((lift) => {
      const outlook = outlooks.get(lift.pen.penId)![lift.week]!;
      return {
        penId: lift.pen.penId,
        week: lift.week,
        tonnes: outlook.biomassT,
        guttedT: outlook.guttedT,
        meanWeightG: outlook.meanWeightG,
      };
    })
    .sort((a, b) => a.week - b.week);

  return {
    bookings,
    weeklyBiomassT: siteBiomassByWeek(planned, horizon, lifts, outlooks),
    shortfall: null,
    skipped,
  };
}

/**
 * The booking a pen holds, for a screen that has one pen open rather than the
 * whole site. Null where the plan leaves it in the water.
 */
export function bookingFor(plan: HarvestPlan, penId: PenId): HarvestBooking | null {
  for (const booking of plan.bookings) {
    if (booking.penId === penId) return booking;
  }
  return null;
}

/**
 * Weeks the plan still leaves over the licence. Empty on a plan that holds,
 * and the whole tail of the horizon on one that could not be made.
 */
export function breachWeeks(plan: HarvestPlan, maxBiomassT: number): number[] {
  const weeks: number[] = [];
  plan.weeklyBiomassT.forEach((biomass, week) => {
    if (biomass > maxBiomassT) weeks.push(week);
  });
  return weeks;
}

/** Tonnes the plan lifts across the horizon, which is what the processor is promised. */
export function plannedTonnes(plan: HarvestPlan): number {
  return plan.bookings.reduce((total, booking) => total + booking.tonnes, 0);
}

/** The week a plan finishes on, or null where it books nothing at all. */
export function lastHarvestWeek(plan: HarvestPlan): number | null {
  let last: number | null = null;
  for (const booking of plan.bookings) {
    if (last === null || booking.week > last) last = booking.week;
  }
  return last;
}

/** Highest share of the licence the site reaches under the plan. */
export function peakUtilisation(plan: HarvestPlan, maxBiomassT: number): number {
  if (maxBiomassT <= 0) return 0;
  let peak = 0;
  for (const biomass of plan.weeklyBiomassT) {
    if (biomass > peak) peak = biomass;
  }
  return peak / maxBiomassT;
}

export function formatPlan(plan: HarvestPlan): string {
  if (plan.bookings.length === 0) {
    return plan.shortfall === null ? 'Nothing to book' : `No plan: week ${plan.shortfall.week}`;
  }
  return `${plan.bookings.length} pens, ${plannedTonnes(plan).toFixed(1)} t`;
}

/** Tonnes the boat has been asked for across the horizon. */
export function committedTonnes(weeklyCapacityT: readonly number[], plan: HarvestPlan): number {
  let ledger = openSlots(weeklyCapacityT);
  for (const booking of plan.bookings) {
    ledger = reserve(ledger, booking.week, booking.penId, booking.tonnes);
  }
  return bookedTonnes(ledger);
}
