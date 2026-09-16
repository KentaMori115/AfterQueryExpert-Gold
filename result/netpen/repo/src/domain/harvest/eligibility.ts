/**
 * When a pen is allowed to go.
 *
 * Two things hold a pen back and they are counted in different currencies. A
 * medicine clears in degree-days, so a treatment given in a cold February
 * holds the fish far longer than the same one in August and the wait cannot be
 * read off a calendar at all. Size is the other, and it runs the same way
 * round: the pen is not held for a fixed number of weeks, it is held until the
 * fish are big enough for the contract.
 *
 * Neither is decided here from first principles. The withdrawal a method
 * carries lives in the treatment table, along with which methods are medicinal
 * at all, and a plan that carried its own copy would be a second version of a
 * regulatory figure. Whether the boat can take the pen that week is a separate
 * question and belongs to the slot ledger.
 */

import { heatUpTo, type HarvestHorizon, type HarvestPen, type PenWeek } from './forecast';
import { blockingTreatment, type TreatmentEvent } from '../health/treatment';

export type HarvestBlocker = 'withdrawal' | 'size' | null;

/**
 * The treatment holding a pen out of a week, or null where none does. Heat is
 * taken up to the end of that week, so the same treatment blocks an early week
 * and clears a later one without anything else changing.
 */
export function heldBy(
  pen: HarvestPen,
  horizon: HarvestHorizon,
  outlook: PenWeek,
): TreatmentEvent | null {
  return blockingTreatment(pen.treatments, heatUpTo(horizon, outlook.at));
}

/**
 * Whether the pen has grown into what the contract will take.
 *
 * Gutted, not live. A contract is written on what the processor receives, and
 * the gap between the two is the pen's own condition rather than a constant,
 * so a deep-conditioned pen reaches a live mean the contract still refuses.
 */
export function isBigEnough(outlook: PenWeek, minHarvestWeightG: number): boolean {
  return outlook.guttedWeightG >= minHarvestWeightG;
}

/** Whether a pen may go in one particular week, ignoring the boat. */
export function isReady(
  pen: HarvestPen,
  horizon: HarvestHorizon,
  outlook: PenWeek,
  minHarvestWeightG: number,
): boolean {
  return heldBy(pen, horizon, outlook) === null && isBigEnough(outlook, minHarvestWeightG);
}

/**
 * The earliest week both floors are behind the pen, or null where the horizon
 * runs out first. Walked rather than solved: the withdrawal moves with the
 * heat and the weight moves with it too, so there is no closed form to reach
 * for and a wrong one would be wrong quietly.
 */
export function earliestHarvestWeek(
  pen: HarvestPen,
  horizon: HarvestHorizon,
  projection: readonly PenWeek[],
  minHarvestWeightG: number,
): number | null {
  for (const outlook of projection) {
    if (isReady(pen, horizon, outlook, minHarvestWeightG)) return outlook.week;
  }
  return null;
}

/**
 * What is holding a pen out of a week, for the line the crew read. Withdrawal
 * is named ahead of size where both apply, because it is the one with a
 * regulator attached.
 */
export function blockerAt(
  pen: HarvestPen,
  horizon: HarvestHorizon,
  outlook: PenWeek,
  minHarvestWeightG: number,
): HarvestBlocker {
  if (heldBy(pen, horizon, outlook) !== null) return 'withdrawal';
  if (!isBigEnough(outlook, minHarvestWeightG)) return 'size';
  return null;
}

export const BLOCKER_LABELS: Record<'withdrawal' | 'size', string> = {
  withdrawal: 'Still inside the withdrawal period',
  size: 'Not yet at harvest weight',
};

export function formatBlocker(blocker: HarvestBlocker): string {
  return blocker === null ? 'Clear to harvest' : BLOCKER_LABELS[blocker];
}
