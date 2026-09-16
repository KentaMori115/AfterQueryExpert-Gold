/**
 * The rope: what it is made of, what it weighs, and what it will stand.
 *
 * A winding rope is not a cable. It is a few hundred cold-drawn steel
 * wires laid up into strands and the strands laid up round a core, and
 * every one of those choices is a trade. More wires of smaller diameter
 * make a rope that bends round a drum without fatiguing and wears out
 * at the surface in a year; fewer and thicker make one that lasts on
 * the surface and cracks inside where nobody can see it.
 *
 * The two numbers everything else in this library needs from a rope are
 * what it will stand and what it weighs a metre — and the second of
 * those is the whole difficulty of deep winding, because a rope long
 * enough to reach the bottom of a deep shaft is mostly engaged in
 * holding itself up.
 */

import { WindingError, insist, count, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { circleArea, weightOf } from "../units/measure.ts";

/** A rope construction, as a rope maker lists it. */
export interface Construction {
  /** What it is called: 6x19, 6x36, and so on. */
  readonly name: string;
  /** How many strands are laid round the core. */
  readonly strands: number;
  /** How many wires are in each strand. */
  readonly wires: number;
  /**
   * The fill factor: how much of the circumscribed circle is steel.
   *
   * About half for a round strand rope, because round wires cannot fill
   * a circle and there is a gap between every pair of them. A locked
   * coil rope uses shaped wires that interlock and reaches three
   * quarters, which is the whole reason anybody puts up with how stiff
   * it is.
   */
  readonly fill: number;
  /**
   * The spinning loss: how much strength is given up to the fact that
   * the wires run at an angle to the rope rather than along it.
   */
  readonly spinning: number;
}

/** A construction, checked. */
export function construction(name: string, strands: number, wires: number, fill: number, spinning: number): Construction {
  insist(name.trim().length > 0, "a construction has to be called something", "name");
  count(strands, "strands");
  count(wires, "wires");
  within(fill, 0.2, 0.85, "fill");
  within(spinning, 0.7, 1, "spinning");
  return { name: name.trim(), strands, wires, fill, spinning };
}

/** The constructions a winding rope is made in. */
export const CONSTRUCTIONS: Readonly<Record<string, Construction>> = {
  "6x19": { name: "6x19 round strand", strands: 6, wires: 19, fill: 0.509, spinning: 0.88 },
  "6x36": { name: "6x36 round strand", strands: 6, wires: 36, fill: 0.514, spinning: 0.87 },
  "6x7": { name: "6x7 round strand", strands: 6, wires: 7, fill: 0.433, spinning: 0.9 },
  locked: { name: "locked coil", strands: 1, wires: 120, fill: 0.764, spinning: 0.9 },
  triangular: { name: "triangular strand", strands: 6, wires: 25, fill: 0.611, spinning: 0.87 },
};

/** A construction by name, or a refusal that says which are known. */
export function constructionNamed(name: string): Construction {
  const found = CONSTRUCTIONS[name.trim()];
  if (found === undefined) {
    throw new WindingError(
      `${name} is not a construction this library knows (${Object.keys(CONSTRUCTIONS).join(", ")})`,
      "construction",
    );
  }
  return found;
}

/** How many wires there are in the rope altogether. */
export function wireCount(one: Construction): number {
  return one.strands * one.wires;
}

/**
 * The diameter of one of the outer wires, in millimetres.
 *
 * From the steel area shared out among the wires, which is the only
 * honest way to get it from a construction and a diameter. It is the
 * number that decides how hard a rope is to bend: a forty millimetre
 * 6x7 rope has four millimetre wires in it and a 6x36 has two, and the
 * first of those cannot be wound at all on a drum the second is happy
 * on.
 */
export function outerWire(one: Rope): number {
  const count = wireCount(one.construction);
  insist(count > 0, "that construction has no wires in it", "construction");
  return round(one.diameter * Math.sqrt(one.construction.fill / count), 4);
}

/** The grades a winding rope wire is drawn to, in newtons a square millimetre. */
export const GRADES: readonly number[] = [1570, 1770, 1960, 2160];

/** A rope, as ordered. */
export interface Rope {
  /** The diameter over the whole rope, in millimetres. */
  readonly diameter: number;
  /** What it is made in. */
  readonly construction: Construction;
  /** The tensile grade of its wire, in newtons a square millimetre. */
  readonly grade: number;
}

/** A rope, checked. */
export function rope(diameter = 40, made = constructionNamed("6x36"), grade = 1960): Rope {
  within(diameter, 6, 90, "diameter");
  insist(GRADES.includes(grade), `${grade} is not a grade wire is drawn to (${GRADES.join(", ")})`, "grade");
  return { diameter, construction: made, grade };
}

/**
 * The steel area of a rope, in square millimetres.
 *
 * The circumscribed circle times the fill factor. It is always a good
 * deal less than the circle a caliper measures, which is why a rope
 * looks stronger than it is and why nobody who has done this
 * calculation once ever does it from the diameter alone again.
 */
export function steelArea(one: Rope): number {
  return round(circleArea(one.diameter) * one.construction.fill, 3);
}

/**
 * What the rope will stand, in kilonewtons.
 *
 * The steel area times the grade times the spinning loss. A forty
 * millimetre rope in 6x36 at nineteen hundred and sixty newtons a
 * square millimetre stands about eleven hundred kilonewtons, which is a
 * hundred and ten tons force and is what the rope maker's table says.
 */
export function breakingLoad(one: Rope): number {
  return round((steelArea(one) * one.grade * one.construction.spinning) / 1000, 2);
}

/**
 * How much more steel a metre of rope holds than a metre of its own
 * cross-section suggests.
 *
 * Every wire in a laid rope runs helically, so it is longer than the
 * rope it is in — and the strands are laid helically round the core as
 * well, so the effect compounds. A metre of rope contains about a metre
 * and a sixth of wire, and the difference is on the weighbridge whether
 * anybody accounts for it or not.
 */
export const LAY_MASS = 1.16;

/**
 * What the rope weighs, in kilograms a metre.
 *
 * The steel area at the density of steel, and then the lay allowance,
 * because the wires are longer than the rope. It is the number that
 * decides how deep a shaft can be wound, and it is the one nobody
 * thinks about until the shaft is deep.
 */
export function massPerMetre(one: Rope): number {
  const lay = one.construction.strands === 1 ? 1.06 : LAY_MASS;
  return round(steelArea(one) * 1e-6 * 7850 * lay, 5);
}

/** What a stated length of it weighs, in kilograms. */
export function ropeMass(one: Rope, metres: number): number {
  nonNegative(metres, "metres");
  return round(massPerMetre(one) * metres, 3);
}

/** What a stated length of it pulls with, in kilonewtons. */
export function ropeWeight(one: Rope, metres: number): number {
  return round(weightOf(ropeMass(one, metres)), 4);
}

/**
 * The length at which a rope will just carry its own weight and no
 * more, in metres.
 *
 * The breaking length. It depends only on the grade and the density of
 * steel — not on the diameter at all, because doubling the diameter
 * quadruples both the strength and the weight. For a nineteen-sixty
 * grade rope it is about twenty-one kilometres, which sounds like a
 * great deal until a factor of safety is applied to it.
 */
export function breakingLength(one: Rope): number {
  const perMetre = ropeWeight(one, 1);
  insist(perMetre > 0, "that rope weighs nothing", "diameter");
  return round(breakingLoad(one) / perMetre, 0);
}

/**
 * The deepest shaft a rope can serve at a stated factor of safety,
 * carrying nothing at all.
 *
 * The breaking length divided by the factor. At a factor of eight it is
 * two and a half kilometres for the best grade made — and that is with
 * no cage, no payload and no acceleration, so the practical limit is a
 * good deal shallower and is the reason deep shafts are wound in stages.
 */
export function deepestEmpty(one: Rope, factor = 8): number {
  within(factor, 1.5, 20, "factor");
  return round(breakingLength(one) / factor, 0);
}

/** The rope described in a line. */
export function describeRope(one: Rope): string {
  return (
    `${one.diameter} mm ${one.construction.name} at ${one.grade} N/mm²: ` +
    `${breakingLoad(one)} kN breaking, ${massPerMetre(one)} kg/m, ` +
    `${wireCount(one.construction)} wires`
  );
}

/**
 * The rope diameter a wanted breaking load asks for, in millimetres.
 *
 * Rounded up to the millimetre, because a rope is ordered in whole
 * millimetres and rounding down would order one that does not reach the
 * load it was chosen for.
 */
export function diameterFor(wanted: number, made = constructionNamed("6x36"), grade = 1960): number {
  positive(wanted, "wanted");
  for (let at = 6; at <= 90; at += 1) {
    if (breakingLoad(rope(at, made, grade)) >= wanted) return at;
  }
  throw new WindingError(`no rope this library knows stands ${wanted} kN in one part`, "wanted");
}

/**
 * How much stronger a locked coil rope is than a round strand one of
 * the same diameter, as a share.
 *
 * Half as much again, because the shaped wires interlock and fill the
 * circle where round ones cannot. It is why locked coil is used where
 * the sheave diameter can be made large enough for it, and it is not
 * used elsewhere because it is very much stiffer.
 */
export function lockedCoilGain(diameter = 40, grade = 1960): number {
  const round0 = breakingLoad(rope(diameter, constructionNamed("6x36"), grade));
  const locked = breakingLoad(rope(diameter, constructionNamed("locked"), grade));
  insist(round0 > 0, "that rope stands nothing", "diameter");
  return round((locked - round0) / round0, 4);
}
