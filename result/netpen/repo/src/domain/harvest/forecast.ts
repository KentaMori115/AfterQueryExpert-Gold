/**
 * Carrying a pen forward, week by week.
 *
 * A harvest plan is an argument about the future, and none of the figures it
 * argues from are stored anywhere. What a pen holds on a Friday five weeks out
 * is the log folded up to that instant, with the last weighed figure carried
 * over the heat between, which is exactly what the stock ledger already does.
 * So this asks the ledger rather than keeping a count of its own: a plan that
 * disagreed with the pen screen about how many fish are in pen 3 would be
 * worth nothing, however good its arithmetic.
 *
 * Weeks are offsets from the instant the plan is made, and every figure is
 * read at a week's end. Nothing here reads a clock: the instant comes in with
 * the request, which is what lets a plan drawn on a fixed date stay drawn.
 */

import { guttedWeightG, guttedYield } from '../growth/condition';
import type { TreatmentEvent } from '../health/treatment';
import type { PenId } from '../ids';
import { positionAt, validate, type StockPosition } from '../stock/ledger';
import type { StockEvent } from '../stock/types';
import type { TemperatureSample } from '../time/degreeDays';
import { addWeeks, type Instant } from '../time/duration';

export interface HarvestPen {
  readonly penId: PenId;
  /** Grid position, and the tie-break when two pens are equally ready. */
  readonly number: number;
  /** The pen's own fitted coefficient, which is what carries weight forward. */
  readonly tgc: number;
  /** Fulton's K off the last sample, which is what sets the gutted yield. */
  readonly conditionFactor: number;
  readonly events: readonly StockEvent[];
  readonly treatments: readonly TreatmentEvent[];
}

export interface HarvestHorizon {
  /** The instant the plan is drawn on. Week 0 ends a week after it. */
  readonly at: Instant;
  /** One slot per week, so the boat's calendar is what sets the horizon. */
  readonly weeks: number;
  /** Daily means, the record and the forecast in one series. */
  readonly temperatures: readonly TemperatureSample[];
}

/** End of each week in the horizon, which is the instant every figure is read at. */
export function weekEnds(horizon: HarvestHorizon): Instant[] {
  const ends: Instant[] = [];
  for (let week = 0; week < horizon.weeks; week += 1) {
    ends.push(addWeeks(horizon.at, week + 1));
  }
  return ends;
}

/**
 * Whether the pen's log can be planned on at all.
 *
 * The ledger's own validation, no second opinion: a log that cannot be folded
 * into a standing position is a log whose biomass figure would be invented,
 * and an invented figure in a licence total is worse than a missing pen.
 */
export function isPlannable(pen: HarvestPen): boolean {
  return validate(pen.events).length === 0;
}

export interface PenWeek {
  readonly week: number;
  readonly at: Instant;
  readonly position: StockPosition;
  readonly meanWeightG: number;
  readonly count: number;
  /** Live tonnes, which is the figure a licence is written against. */
  readonly biomassT: number;
  /** Gutted mean weight, which is the figure a contract is written against. */
  readonly guttedWeightG: number;
  /** Gutted tonnes, which is what a well boat actually lands. */
  readonly guttedT: number;
}

/** Tonnes from the ledger's own kilogrammes, which is the unit a licence uses. */
export function positionTonnes(position: StockPosition): number {
  return position.biomassKg / 1_000;
}

/**
 * The pen's outlook over the horizon, one entry per week.
 *
 * Every week is a fresh fold of the log rather than a step on from the week
 * before. It costs a little and it means an event dated inside the horizon,
 * a mortality already recorded or a harvest already booked elsewhere, lands
 * in the week it belongs to rather than being missed.
 */
export function projectPen(pen: HarvestPen, horizon: HarvestHorizon): PenWeek[] {
  const options = { tgc: pen.tgc, temperatures: horizon.temperatures };

  const yieldFraction = guttedYield(pen.conditionFactor);

  return weekEnds(horizon).map((at, week) => {
    const position = positionAt(pen.events, at, options);
    const biomassT = positionTonnes(position);
    return {
      week,
      at,
      position,
      meanWeightG: position.meanWeightG,
      count: position.count,
      biomassT,
      guttedWeightG: guttedWeightG(position.meanWeightG, pen.conditionFactor),
      guttedT: biomassT * yieldFraction,
    };
  });
}

/** Every plannable pen's outlook, kept by pen so a plan can pull one out. */
export function projectPens(
  pens: readonly HarvestPen[],
  horizon: HarvestHorizon,
): Map<PenId, PenWeek[]> {
  const outlooks = new Map<PenId, PenWeek[]>();
  for (const pen of pens) {
    outlooks.set(pen.penId, projectPen(pen, horizon));
  }
  return outlooks;
}

/** Daily means up to a week's end, which is all the heat that has happened by then. */
export function heatUpTo(horizon: HarvestHorizon, at: Instant): TemperatureSample[] {
  return horizon.temperatures.filter((sample) => sample.at < at);
}

export function formatWeek(week: number): string {
  return `week ${week}`;
}
