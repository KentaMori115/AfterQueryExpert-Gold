/**
 * The weeks a boat can come, and what it can take when it does.
 *
 * A processor books a site into a slot: one visit a week, a stated tonnage it
 * will not go past, and whatever pens the site can fit under that tonnage. It
 * is the part of a harvest plan nobody on the site controls, and it is why a
 * plan is not simply "take the ceiling off". Two pens that both have to come
 * out can share a week only while what they land together stays inside the
 * boat's figure, and a pen that grew past that figure on its own has to be
 * lifted earlier rather than later, which is the opposite of what everything
 * else about it wants.
 *
 * What the boat counts is what it lands, not what stood in the water. Two pens
 * at the same standing tonnage do not fill the same amount of a slot, because
 * the yield follows the pen's own condition.
 *
 * The ledger is rebuilt rather than mutated on each booking. A plan walks the
 * same weeks several times over as the ceiling moves, and a structure that
 * remembers a half-finished attempt is a structure that plans differently
 * depending on what it tried first.
 */

import type { PenId } from '../ids';

export interface WeekSlot {
  readonly week: number;
  /** Tonnes the boat will land that week, across every pen in it. */
  readonly capacityT: number;
  /** The pens holding the slot, in the order they were booked into it. */
  readonly penIds: readonly PenId[];
  /** Gutted tonnes already spoken for that week. */
  readonly bookedT: number;
}

export type SlotLedger = readonly WeekSlot[];

/** An empty ledger over a week-by-week capacity list. */
export function openSlots(weeklyCapacityT: readonly number[]): SlotLedger {
  return weeklyCapacityT.map((capacityT, week) => ({
    week,
    capacityT,
    penIds: [],
    bookedT: 0,
  }));
}

export function slotAt(ledger: SlotLedger, week: number): WeekSlot | null {
  return ledger[week] ?? null;
}

/** What the boat could still land that week. */
export function remainingT(ledger: SlotLedger, week: number): number {
  const slot = slotAt(ledger, week);
  if (slot === null) return 0;
  return slot.capacityT - slot.bookedT;
}

/** A week with room left in it. A week outside the horizon never has any. */
export function isFree(ledger: SlotLedger, week: number): boolean {
  const slot = slotAt(ledger, week);
  return slot !== null && slot.bookedT < slot.capacityT;
}

/**
 * Whether a tonnage can still go in a week: the week has to exist and what is
 * already booked into it plus this has to stay inside the boat's figure.
 * Equality passes, because a capacity is what the boat takes rather than what
 * it stops short of.
 */
export function fits(ledger: SlotLedger, week: number, tonnes: number): boolean {
  const slot = slotAt(ledger, week);
  if (slot === null) return false;
  return slot.bookedT + tonnes <= slot.capacityT;
}

/** The same ledger with one more pen in a week. Throws rather than overfilling. */
export function reserve(
  ledger: SlotLedger,
  week: number,
  penId: PenId,
  tonnes: number,
): SlotLedger {
  const slot = slotAt(ledger, week);
  if (slot === null) {
    throw new RangeError(`No harvest slot in week ${week}`);
  }
  if (slot.penIds.includes(penId)) {
    throw new RangeError(`${String(penId)} is already in week ${week}`);
  }
  if (slot.bookedT + tonnes > slot.capacityT) {
    throw new RangeError(`Week ${week} cannot land another ${tonnes} t`);
  }
  return ledger.map((existing) =>
    existing.week === week
      ? { ...existing, penIds: [...existing.penIds, penId], bookedT: existing.bookedT + tonnes }
      : existing,
  );
}

/** Weeks with room left, earliest first. */
export function openWeeks(ledger: SlotLedger): number[] {
  return ledger.filter((slot) => slot.bookedT < slot.capacityT).map((slot) => slot.week);
}

/** Tonnes the plan has committed the boat to across the horizon. */
export function bookedTonnes(ledger: SlotLedger): number {
  return ledger.reduce((total, slot) => total + slot.bookedT, 0);
}

/** Tonnes the boat could have landed and was not asked for. */
export function idleCapacityT(ledger: SlotLedger): number {
  return ledger.reduce((total, slot) => total + (slot.capacityT - slot.bookedT), 0);
}

export function formatSlot(slot: WeekSlot): string {
  if (slot.penIds.length === 0) return `week ${slot.week}: open, ${slot.capacityT.toFixed(1)} t`;
  return `week ${slot.week}: ${slot.penIds.join(', ')}, ${slot.bookedT.toFixed(1)} t`;
}
