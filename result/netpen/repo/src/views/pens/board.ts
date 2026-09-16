/**
 * Ordering and counting for the pen board.
 *
 * The board is the first thing on the screen in the morning, and the order the
 * cards come in is the whole of its usefulness. Sorting by pen number is what
 * the crew asks for when they are walking the grid; sorting by attention is
 * what they want when they sit down with a coffee and need to know where the
 * day is going to go.
 *
 * Attention is scored rather than filtered so a pen with three amber states
 * outranks a pen with one, which matches how a manager actually reads it. The
 * score is deliberately coarse: it decides an order, not a number anybody
 * quotes.
 */

import type { BoardSort } from '@/app/stores/preferences';
import type { PenView } from '@/data/projections/pen';

/** Weights, worst first. Lice carries a statutory clock, so it leads. */
const LICE_WEIGHT = 50;
const WITHDRAWAL_WEIGHT = 24;
const OXYGEN_WEIGHT = 30;
const DENSITY_WEIGHT = 22;
const MORTALITY_WEIGHT = 26;
const STALE_COUNT_WEIGHT = 12;

/** A count older than this is worth flagging, whatever it said. */
export const COUNT_STALE_DAYS = 9;

export interface BoardSummary {
  readonly pens: number;
  readonly stocked: number;
  readonly biomassT: number;
  readonly fish: number;
  readonly needingAttention: number;
  readonly worstLice: number | null;
  readonly overdueCounts: number;
}

export function isStocked(view: PenView): boolean {
  return view.position !== null && view.position.count > 0;
}

export function daysSinceCount(view: PenView, now: number): number | null {
  const latest = view.lice.latest;
  return latest === null ? null : (now - latest.countedAt) / 86_400_000;
}

export function countIsOverdue(view: PenView, now: number): boolean {
  if (!isStocked(view)) return false;
  const days = daysSinceCount(view, now);
  return days === null || days > COUNT_STALE_DAYS;
}

/**
 * How loudly a pen is asking for somebody. Zero means it is fine; nothing here
 * ever goes negative, because a pen being unusually healthy is not a reason to
 * push a merely adequate one down the board.
 */
export function attentionScore(view: PenView, now: number): number {
  if (!isStocked(view)) return 0;

  let score = 0;

  if (view.lice.status === 'enforcement') score += LICE_WEIGHT * 1.4;
  else if (view.lice.status === 'over-limit') score += LICE_WEIGHT;
  else if (view.lice.status === 'approaching') score += LICE_WEIGHT / 2;
  if (view.lice.obligation.required) score += LICE_WEIGHT / 2;
  score += Math.min(3, view.lice.weeksOver) * 6;

  if (view.oxygen.band === 'critical') score += OXYGEN_WEIGHT;
  else if (view.oxygen.band === 'low') score += OXYGEN_WEIGHT * 0.7;
  else if (view.oxygen.band === 'reduced' || view.oxygen.band === 'supersaturated') {
    score += OXYGEN_WEIGHT * 0.3;
  }

  if (view.densityStatus === 'over-limit') score += DENSITY_WEIGHT;
  else if (view.densityStatus === 'watch') score += DENSITY_WEIGHT * 0.4;

  if (view.mortalityLevel === 'incident') score += MORTALITY_WEIGHT;
  else if (view.mortalityLevel === 'elevated') score += MORTALITY_WEIGHT * 0.5;

  if (view.withdrawal !== null && !view.withdrawal.cleared) score += WITHDRAWAL_WEIGHT;
  if (countIsOverdue(view, now)) score += STALE_COUNT_WEIGHT;

  return Math.round(score);
}

export function needsAttention(view: PenView, now: number): boolean {
  return attentionScore(view, now) >= LICE_WEIGHT / 2;
}

function liceOf(view: PenView): number {
  return view.lice.averages?.adultFemale ?? -1;
}

/**
 * Sorted copy. Empty pens fall to the bottom of every order except pen number,
 * where the point of the order is that it matches the walk along the mooring.
 */
export function sortBoard(
  views: readonly PenView[],
  order: BoardSort,
  now: number,
): readonly PenView[] {
  const sorted = views.slice();

  if (order === 'pen') {
    sorted.sort((a, b) => a.pen.number - b.pen.number);
    return sorted;
  }

  sorted.sort((a, b) => {
    const stockedDelta = Number(isStocked(b)) - Number(isStocked(a));
    if (stockedDelta !== 0) return stockedDelta;

    if (order === 'lice') {
      const delta = liceOf(b) - liceOf(a);
      if (delta !== 0) return delta;
    } else if (order === 'biomass') {
      const delta = b.biomassKg - a.biomassKg;
      if (delta !== 0) return delta;
    } else {
      const delta = attentionScore(b, now) - attentionScore(a, now);
      if (delta !== 0) return delta;
    }

    return a.pen.number - b.pen.number;
  });

  return sorted;
}

export function summarise(views: readonly PenView[], now: number): BoardSummary {
  const stocked = views.filter(isStocked);
  const lice = stocked.map(liceOf).filter((value) => value >= 0);

  return {
    pens: views.length,
    stocked: stocked.length,
    biomassT: stocked.reduce((total, view) => total + view.biomassKg, 0) / 1000,
    fish: stocked.reduce((total, view) => total + (view.position?.count ?? 0), 0),
    needingAttention: stocked.filter((view) => needsAttention(view, now)).length,
    worstLice: lice.length === 0 ? null : Math.max(...lice),
    overdueCounts: stocked.filter((view) => countIsOverdue(view, now)).length,
  };
}
