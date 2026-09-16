/**
 * The fan, and where it settles.
 *
 * A fan has no duty of its own. It has a characteristic — a curve of
 * what pressure it will make against what quantity — and the colliery
 * has a resistance, and the air that goes down the pit is where the two
 * cross. Nothing else decides it. A fan bought for four hundred cubic
 * metres a second on a pit that wants two hundred does not deliver four
 * hundred and does not deliver two hundred: it delivers whatever the
 * crossing says, and the sheet the maker supplied is not the answer.
 *
 * The other half of it is that a colliery has a second fan it did not
 * buy. Warm air up the upcast and cold air down the downcast is a
 * column of one against a column of the other, and the difference is a
 * pressure that works whether the fan is running or not — the one that
 * keeps a pit ventilated through a breakdown, and the one that reverses
 * in a hot summer and has drowned men in a downcast.
 */

import { insist, nonNegative, positive, real, share as checkShare } from "../errors.ts";
import { round } from "../units/round.ts";
import { GRAVITY } from "../units/measure.ts";
import { airPower } from "./airway.ts";

/** A fan, as the maker's sheet describes it. */
export interface Fan {
  /** What it is called. */
  readonly name: string;
  /** The pressure it makes against a shut door, in pascals. */
  readonly shutoff: number;
  /** The quantity it passes against nothing at all, in cubic metres a second. */
  readonly delivery: number;
  /** What share of the work in it reaches the air. */
  readonly efficiency: number;
}

/** What a fan turns into air, of what it is given. */
export const FAN_EFFICIENCY = 0.7;

/** A fan, checked. */
export function fan(name: string, shutoff = 3500, delivery = 400, efficiency = FAN_EFFICIENCY): Fan {
  insist(name.trim().length > 0, "a fan has to be called something", "name");
  positive(shutoff, "shutoff");
  positive(delivery, "delivery");
  checkShare(efficiency, "efficiency");
  positive(efficiency, "efficiency");
  return { name: name.trim(), shutoff, delivery, efficiency };
}

/**
 * What the fan makes at a stated quantity, in pascals.
 *
 * The curve between the two ends of it, which is a parabola: all of the
 * pressure and none of the air against a shut door, all of the air and
 * none of the pressure at free delivery. Past that it makes nothing,
 * because a fan asked to pass more air than it can is not a fan, it is
 * a hole in the wall of the fan house.
 */
export function characteristic(one: Fan, quantity: number): number {
  nonNegative(quantity, "quantity");
  const share0 = quantity / one.delivery;
  return round(Math.max(0, one.shutoff * (1 - share0 * share0)), 2);
}

/**
 * The natural ventilating pressure, in pascals.
 *
 * The upcast is warm and the downcast is cold, so one column of air
 * weighs less than the other and the difference drives the colliery. It
 * is worth a few hundred pascals in a deep pit, which is a tenth of
 * what the fan does and the whole of what the fan does after the fan
 * has stopped.
 */
export function naturalPressure(depth: number, downcast = 1.2, upcast = 1.1): number {
  positive(depth, "depth");
  positive(downcast, "downcast");
  positive(upcast, "upcast");
  return round((downcast - upcast) * GRAVITY * depth, 2);
}

/**
 * The natural pressure is the reason a colliery is ventilated at all on
 * the day its fan is stopped for repair, and the reason a pit that has
 * stood through a hot summer is entered with a lamp and not with a
 * light. It is worth a few hundred pascals in a deep shaft, which is a
 * tenth of what the fan does and the whole of what remains when the fan
 * is doing nothing.
 */

/** Where a fan and a circuit cross: the quantity and the pressure at it. */
export interface Working {
  /** What goes down the pit, in cubic metres a second. */
  readonly quantity: number;
  /** What it takes to put it there, in pascals. */
  readonly pressure: number;
}

/**
 * Where the fan and the colliery settle.
 *
 * The crossing of the two curves, with the natural pressure counted on
 * the fan's side because that is the side it works on — or against it,
 * written as a negative, which is the hot summer when the upcast is
 * cooler than the day and the pit ventilates itself backwards. A fan
 * the natural pressure has beaten outright passes nothing at all.
 */
export function operatingPoint(one: Fan, resistance: number, natural = 0): Working {
  positive(resistance, "resistance");
  real(natural, "natural");
  if (one.shutoff + natural <= 0) return { quantity: 0, pressure: 0 };
  const curve = one.shutoff / (one.delivery * one.delivery);
  const quantity = Math.sqrt((one.shutoff + natural) / (resistance + curve));
  return { quantity: round(quantity, 3), pressure: round(resistance * quantity * quantity, 2) };
}

/** What the air costs at the fan's own shaft, in kilowatts. */
export function fanPower(one: Fan, resistance: number, natural = 0): number {
  const at = operatingPoint(one, resistance, natural);
  return round(airPower(at.pressure, at.quantity) / one.efficiency, 3);
}



/**
 * The stiffest colliery that fan will still ventilate.
 *
 * The resistance at which the crossing falls exactly on the quantity
 * wanted. Anything tighter than this and the pit is short of air with
 * the fan running flat out, which is the week somebody is sent to look
 * for doors standing open.
 */
export function stiffestFor(one: Fan, wanted: number, natural = 0): number {
  positive(wanted, "wanted");
  insist(wanted < one.delivery, "no fan passes more than its free delivery", "wanted");
  return round(characteristic(one, wanted) / (wanted * wanted) + natural / (wanted * wanted), 6);
}




/** The fan described in a line. */
export function describeFan(one: Fan): string {
  return `${one.name}: ${one.shutoff} Pa shut, ${one.delivery} m³/s free, ${round(one.efficiency * 100, 0)}% of it into the air`;
}
