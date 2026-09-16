/**
 * What the winding engine has to do, and what it has to be rated at.
 *
 * The two are not the same number and the difference is the whole of
 * this module. A winder's peak load lasts fifteen seconds and its
 * cycle lasts two minutes, so a motor rated at the peak is three times
 * the motor the duty needs — and a motor rated at the mean will burn
 * out, because heating goes as the square of the current and the mean
 * of a square is not the square of a mean.
 *
 * The other thing that surprises people is the rope. A shaft of nine
 * hundred metres hangs eight tonnes of rope, and at the start of a wind
 * all of it is on the rising side and at the end all of it is on the
 * falling side. The winder therefore starts a wind lifting the payload
 * *and* the rope, and finishes it being driven by the rope — and the
 * swing between the two is as large as the payload. That is what a
 * balance rope is for and it is why deep shafts have them.
 */

import { insist, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { forceOf, weightOf } from "../units/measure.ts";
import { type Rope, massPerMetre } from "../rope/index.ts";
import { type Conveyance, gross } from "../cage/conveyance.ts";
import { type Profile, cycleTime, windTime } from "../cycle/index.ts";

/** Everything hanging on a winder, as it is set up for a wind. */
export interface Duty {
  /** What is going up, loaded. */
  readonly rising: Conveyance;
  /** What is coming down, empty unless somebody says otherwise. */
  readonly falling: Conveyance;
  /** The rope it hangs on. */
  readonly rope: Rope;
  /** How many ropes there are. */
  readonly ropes: number;
  /** The balance rope hung beneath, in kilograms a metre, or nought for none. */
  readonly balance: number;
  /** How deep the wind is, in metres. */
  readonly depth: number;
  /** The drum or wheel radius the force acts at, in metres. */
  readonly radius: number;
  /** What the rotating parts weigh, referred to the rope, in kilograms. */
  readonly inertia: number;
}

/** A duty, checked. */
export function duty(over: Partial<Duty> & Pick<Duty, "rising" | "falling" | "rope" | "depth">): Duty {
  const found: Duty = {
    rising: over.rising,
    falling: over.falling,
    rope: over.rope,
    ropes: over.ropes ?? 1,
    balance: over.balance ?? 0,
    depth: over.depth,
    radius: over.radius ?? 2.1,
    inertia: over.inertia ?? 30_000,
  };
  positive(found.depth, "depth");
  positive(found.radius, "radius");
  positive(found.ropes, "ropes");
  nonNegative(found.balance, "balance");
  nonNegative(found.inertia, "inertia");
  return found;
}

/** The winding rope's weight a metre, all ropes together, in kilograms. */
export function ropeMetre(one: Duty): number {
  return round(massPerMetre(one.rope) * one.ropes, 5);
}

/**
 * The out-of-balance the winder sees, in kilonewtons, at a stated point
 * of the wind.
 *
 * The conveyances, which do not change; and the ropes, which do. The
 * position is measured as how far the rising conveyance still has to
 * go, so nought is the end of the wind and the whole depth is the
 * start.
 */
export function outOfBalance(one: Duty, toGo: number): number {
  within(toGo, 0, one.depth, "toGo");
  const conveyances = gross(one.rising) - one.falling.tare - one.falling.payload;
  // Winding rope: the rising side carries what is still to be wound in.
  const winding = ropeMetre(one) * (toGo - (one.depth - toGo));
  // Balance rope: hung beneath, so it is the mirror image and cancels.
  const balancing = one.balance * ((one.depth - toGo) - toGo);
  return round(forceOf(conveyances) + forceOf(winding) + forceOf(balancing), 4);
}

/** The out-of-balance at the start of the wind, which is usually the worst. */
export function atStart(one: Duty): number {
  return outOfBalance(one, one.depth);
}

/** And at the end of it, which is usually the least. */
export function atEnd(one: Duty): number {
  return outOfBalance(one, 0);
}

/**
 * How far the out-of-balance swings across a wind, in kilonewtons.
 *
 * Nought when the balance rope matches the winding rope, and twice the
 * rope's whole weight when there is none. On a nine hundred metre shaft
 * that is as much again as the payload, and it is the reason a winder
 * without a balance rope has to be rated for a load it only sees at one
 * end of the wind.
 */
export function swing(one: Duty): number {
  return round(Math.abs(atStart(one) - atEnd(one)), 4);
}

/** The balance rope that takes the swing out, in kilograms a metre. */
export function balanceWanted(one: Duty): number {
  return ropeMetre(one);
}

/** Whether the installation is balanced against its own rope. */
export function ropeBalanced(one: Duty, tolerance = 0.05): boolean {
  within(tolerance, 0, 1, "tolerance");
  const wanted = balanceWanted(one);
  insist(wanted > 0, "that duty hangs no rope at all", "rope");
  return Math.abs(one.balance - wanted) / wanted <= tolerance;
}

/**
 * Everything that has to be accelerated, in kilograms.
 *
 * Both conveyances, all the rope on both sides, the balance rope, and
 * the rotating parts referred to the rope. The last of those is the one
 * that is left out, and on a large winder the drum and the motor
 * between them weigh more than everything hanging.
 */
export function movingMass(one: Duty): number {
  const hanging = gross(one.rising) + gross(one.falling);
  const ropes = ropeMetre(one) * one.depth + one.balance * one.depth;
  return round(hanging + ropes + one.inertia, 1);
}

/** The force accelerating that mass takes, in kilonewtons. */
export function accelerationForce(one: Duty, acceleration: number): number {
  nonNegative(acceleration, "acceleration");
  return round((movingMass(one) * acceleration) / 1000, 4);
}

/** The whole force on the rope at a point of the wind, in kilonewtons. */
export function force(one: Duty, toGo: number, acceleration: number): number {
  return round(outOfBalance(one, toGo) + accelerationForce(one, acceleration), 4);
}

/** The power that force takes at a stated speed, in kilowatts. */
export function powerAt(one: Duty, toGo: number, acceleration: number, speed: number): number {
  nonNegative(speed, "speed");
  return round(force(one, toGo, acceleration) * speed, 3);
}

/**
 * The peak power a wind takes, in kilowatts.
 *
 * At the end of the acceleration, where the winder is still
 * accelerating and has already reached full speed. It lasts an instant
 * and it sizes the motor's overload, the gearing and the brakes; it
 * does not size the motor.
 */
export function peakPower(one: Duty, how: Profile): number {
  const toGo = one.depth - how.creepFor - (how.full * how.full) / (2 * how.accelerate);
  const at = Math.max(0, Math.min(one.depth, toGo));
  return powerAt(one, at, how.accelerate, how.full);
}

/**
 * The root-mean-square power over the whole cycle, in kilowatts.
 *
 * What actually sizes the motor, because heating goes as the square of
 * the current and the standing time counts as part of the cycle. It is
 * typically half the peak, and a works that has rated its motor on the
 * peak has bought twice the machine it needed.
 */
export function rmsPower(one: Duty, how: Profile, steps = 200): number {
  positive(steps, "steps");
  const moving = windTime(how, one.depth);
  const whole = cycleTime(how, one.depth);
  insist(whole > 0, "that cycle takes no time", "depth");
  let sum = 0;
  for (let at = 0; at < steps; at += 1) {
    const share = (at + 0.5) / steps;
    const toGo = one.depth * (1 - share);
    const acceleration = share < 0.25 ? how.accelerate : share > 0.85 ? -how.decelerate : 0;
    const speed = share < 0.25 ? how.full * (share / 0.25) : share > 0.85 ? how.full * ((1 - share) / 0.15) : how.full;
    const power = powerAt(one, toGo, Math.max(0, acceleration), speed);
    sum += power * power * (moving / steps);
  }
  return round(Math.sqrt(sum / whole), 2);
}

/** The motor rating a duty asks for, in kilowatts. */
export function motorFor(one: Duty, how: Profile, margin = 1.15): number {
  positive(margin, "margin");
  insist(margin >= 1, "a margin below one is not a margin", "margin");
  return round(rmsPower(one, how) * margin, 0);
}

/** How much larger the peak is than the rating, as a ratio. */
export function overloadRatio(one: Duty, how: Profile): number {
  const rating = rmsPower(one, how);
  insist(rating > 0, "that winder does no work at all", "depth");
  return round(peakPower(one, how) / rating, 3);
}

/**
 * The energy a wind takes, in kilowatt hours.
 *
 * The work done against the out-of-balance, which is the payload
 * raised through the depth and nothing else once the ropes are
 * balanced. Everything the winder puts into accelerating the mass it
 * gets back on the deceleration, less what the machine loses on the way
 * round.
 */
export function energyPerWind(one: Duty, efficiency = 0.9): number {
  within(efficiency, 0.3, 1, "efficiency");
  const useful = ((gross(one.rising) - one.falling.tare - one.falling.payload) * 9.80665 * one.depth) / 1000;
  return round(useful / 3600 / efficiency, 4);
}

/** And a tonne raised, in kilowatt hours. */
export function energyPerTonne(one: Duty, efficiency = 0.9): number {
  const payload = one.rising.payload;
  insist(payload > 0, "that wind carries nothing to spread the energy over", "payload");
  return round(energyPerWind(one, efficiency) / (payload / 1000), 4);
}

/**
 * The energy a deceleration gives back, in kilowatt hours.
 *
 * A winder that can regenerate puts it into the supply; one that cannot
 * puts it into a resistance bank and warms the engine house. It is a
 * twentieth of what the wind took — the kinetic energy of the moving
 * mass and nothing else, because in a balanced winder the descending
 * conveyance's potential energy has already been netted off against the
 * rising one's. That is a good deal less than most people guess, and
 * knowing it is the difference between specifying a regenerative drive
 * because it pays and specifying one because it sounds as though it
 * ought to.
 */
export function regenerated(one: Duty, how: Profile, efficiency = 0.9): number {
  within(efficiency, 0.3, 1, "efficiency");
  const stopping = (movingMass(one) * how.full * how.full) / 2 / 1000;
  return round((stopping * efficiency) / 3600, 4);
}

/** The share of a wind's energy that comes back on the brake. */
export function regeneratedShare(one: Duty, how: Profile, efficiency = 0.9): number {
  const took = energyPerWind(one, efficiency);
  insist(took > 0, "that wind takes no energy", "depth");
  return round(regenerated(one, how, efficiency) / took, 4);
}

/** The duty in a line, for a report. */
export function describeDuty(one: Duty, how: Profile): string {
  return (
    `${atStart(one)} kN at the start and ${atEnd(one)} at the end, swinging ${swing(one)}: ` +
    `${peakPower(one, how)} kW peak, ${rmsPower(one, how)} kW r.m.s., ` +
    `${motorFor(one, how)} kW of motor`
  );
}

/** How long the wind this duty describes takes, in seconds. */
export function windLasts(one: Duty, how: Profile): number {
  return windTime(how, one.depth);
}
