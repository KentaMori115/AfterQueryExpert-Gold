/**
 * The post brake: the one thing on a winding installation that has to
 * work when nothing else is working.
 *
 * Every other retardation in this library is a figure somebody chose. A
 * brake is a machine, and what it gives comes out of six things that
 * can be measured with a rule and a spring balance: how big the path
 * round the drum is, how wide a shoe is, how much of the path a shoe
 * covers, how many shoes bear, what the lining grips at, and how hard
 * each shoe is pressed on.
 *
 * Two rules govern it and they pull opposite ways. It has to be strong
 * enough to hold the wind standing, which is a multiple of the worst
 * out-of-balance and not the ordinary one; and on a friction winder it
 * has to be weak enough that the ropes still grip, because a brake
 * harder than the capstan equation allows does not stop a wind, it
 * polishes a wheel.
 *
 * The other thing worth being clear about is that the retardation a
 * brake gives is two numbers. Winding, the load is on the rising side
 * and helps to stop it. Lowering, the same load drives the wind and the
 * brake has to take it off before it retards anything at all. The
 * second figure is the smaller one and it is the one an inspector asks
 * for.
 */

import { WindingError, insist, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { gross } from "../cage/index.ts";
import { massPerMetre } from "../rope/index.ts";
import { SLIP_MARGIN, tensions, workingRatio } from "../drum/koepe.ts";
import { leastOutOfBalance, mostOutOfBalance, movingMass, outOfBalance, worstOutOfBalance } from "../power/index.ts";
import { overwindRoom } from "../shaft/index.ts";
import { type Winder, dutyOf, wheelOf, windLength } from "../winder/model.ts";
import { curveSpeed, retardationFor, stoppingDistance } from "./gear.ts";

/** A post brake, as it stands on the engine house floor. */
export interface Brake {
  /** The diameter of the path the shoes bear on, in metres. */
  readonly diameter: number;
  /** How wide a shoe is, in metres. */
  readonly width: number;
  /** How much of the path one shoe covers, in degrees. */
  readonly arc: number;
  /** How many shoes bear on the path. */
  readonly shoes: number;
  /** What the lining grips at. */
  readonly friction: number;
  /** The force each shoe is applied with, in kilonewtons. */
  readonly force: number;
}

/** A brake, checked. */
export function brake(over: Partial<Brake> = {}): Brake {
  const found: Brake = {
    diameter: over.diameter ?? 3.6,
    width: over.width ?? 0.25,
    arc: over.arc ?? 60,
    shoes: over.shoes ?? 2,
    friction: over.friction ?? 0.35,
    force: over.force ?? 200,
  };
  within(found.diameter, 0.5, 12, "diameter");
  within(found.width, 0.02, 1.5, "width");
  within(found.arc, 5, 180, "arc");
  within(found.shoes, 1, 8, "shoes");
  within(found.friction, 0.05, 0.6, "friction");
  positive(found.force, "force");
  return found;
}

/**
 * The brake on a machine, where the sheet says what one is on it.
 *
 * A certificate need not name a brake and plenty of them do not, so the
 * asking is separated from the having: a winder with nothing said about
 * its brake is not a winder without one, it is a winder nobody has
 * measured. Everything below wants a brake, and this is where one comes
 * from when the answer is a file rather than a figure.
 */
export function brakeOf(of: Winder): Brake {
  const found = of.brake;
  if (found === undefined) {
    throw new WindingError("nothing has been said about that winder's brake", "brake");
  }
  return found;
}

/**
 * How much more than the standing load a brake is asked to hold.
 *
 * Three times, and the reason for three rather than two is the shape of
 * the failure. A brake that is holding is a brake nobody is watching:
 * the engineman has gone for his tea and the load is on the shoes for
 * an hour. Linings glaze, springs settle and oil finds its way to the
 * one place it must not be, and every one of those takes something off
 * the figure that was measured on the day of the test.
 */
export const HOLDING_MARGIN = 3;

/**
 * The most a shoe is pressed on, in newtons a square millimetre.
 *
 * Not a strength: a lining will take several times this and not break.
 * It is a heat figure. The energy of one emergency stop goes into the
 * path as heat and comes out through the area of the shoe, and a shoe
 * pressed harder than this on a small path burns its lining off in a
 * summer.
 */
export const MOST_SHOE_PRESSURE = 0.7;

/**
 * The torque the shoes put on the drum shaft, in kilonewton metres.
 *
 * Friction times the applied force is what one shoe drags with, and
 * every shoe drags at the same radius, so the shoes multiply and
 * nothing else does.
 */
export function torque(one: Brake): number {
  return round(one.friction * one.force * one.shoes * (one.diameter / 2), 4);
}

/**
 * That torque referred to the rope, in kilonewtons.
 *
 * The path is on the drum and the rope leaves the drum, so the pull the
 * shoes are worth at the rope is the torque over the radius the rope
 * comes off at. A large drum is therefore worse braked than a small one
 * with the same shoes on it, which is not obvious and is the reason
 * brake paths are built out to the cheek of the drum rather than round
 * the shaft.
 */
export function holdingPull(of: Winder): number {
  return round(torque(brakeOf(of)) / dutyOf(of).radius, 4);
}

/**
 * The most a friction wheel will pass, in kilonewtons.
 *
 * The capstan equation again, read the other way about. The wheel
 * carries the two sides at a ratio the lining sets, so the difference
 * it can hold between them is the slack side times one less than that
 * ratio — and the slack side is smallest at one end of the wind or the
 * other, so the walk decides it rather than the arithmetic.
 *
 * Nothing above this figure is worth applying. A friction winder with
 * more brake than the ropes grip is a friction winder that slips on the
 * day it is wanted, and it takes the lining with it.
 */
export function gripPull(of: Winder, margin = SLIP_MARGIN): number {
  insist(of.drive.kind === "koepe", "a drum winder holds by the shoes and not by the ropes", "drive");
  const allowed = workingRatio(wheelOf(of), margin);
  const depth = windLength(of);
  const rising = weightOf(gross(of.rising));
  const falling = weightOf(gross(of.falling));
  let least = Number.POSITIVE_INFINITY;
  for (let at = 0; at <= 100; at += 1) {
    const found = tensions(of.rope, depth, rising, falling, (depth * at) / 100, of.ropes, of.balance);
    const passes = found.slack * (allowed - 1);
    if (passes < least) least = passes;
  }
  return round(least, 4);
}

/**
 * What the brake actually holds at the rope, in kilonewtons.
 *
 * The shoes on a drum winder. On a friction winder, the shoes or what
 * the ropes will pass, whichever gives way first — and on a deep skip
 * winder without a balance rope it is the ropes, every time.
 */
export function heldPull(of: Winder): number {
  const shoes = holdingPull(of);
  if (of.drive.kind === "drum") return shoes;
  return round(Math.min(shoes, gripPull(of)), 4);
}

/** Whether the brake holds the wind standing, with the margin the rules want. */
export function holds(of: Winder, margin = HOLDING_MARGIN): boolean {
  positive(margin, "margin");
  return heldPull(of) >= margin * worstOutOfBalance(dutyOf(of));
}

/**
 * The force each shoe wants to hold it, in kilonewtons.
 *
 * The question a colliery actually asks, which is not whether the brake
 * holds but what has to be done to the springs so that it does. It is
 * the shoes' figure and not the ropes': no spring on a friction winder
 * buys anything past what the wheel passes.
 */
export function forceFor(of: Winder, margin = HOLDING_MARGIN): number {
  positive(margin, "margin");
  const one = brakeOf(of);
  const wanted = margin * worstOutOfBalance(dutyOf(of)) * dutyOf(of).radius;
  return round(wanted / (one.friction * one.shoes * (one.diameter / 2)), 4);
}

/**
 * The retardation the brake gives on a wind, in metres a second squared.
 *
 * Winding, the load is where it helps: the out-of-balance is already
 * pulling backwards on the drum and the shoes are only asked for the
 * rest. The figure to take is the least the out-of-balance ever is,
 * because a stop can be called for at any point of the wind and the
 * engineman does not get to choose the point.
 */
export function retardationWinding(of: Winder): number {
  const force = heldPull(of) + leastOutOfBalance(dutyOf(of));
  return round(Math.max(0, (force * 1000) / movingMass(dutyOf(of))), 4);
}

/**
 * And on a lowering wind, where the same load is in the way.
 *
 * The load is now driving and the brake has to take all of it off
 * before a single metre a second squared of retardation appears. Take
 * the most the out-of-balance ever is, and where the brake is weaker
 * than that there is no retardation to report: the wind runs away and
 * the figure is nought.
 */
export function retardationLowering(of: Winder): number {
  const force = heldPull(of) - mostOutOfBalance(dutyOf(of));
  return round(Math.max(0, (force * 1000) / movingMass(dutyOf(of))), 4);
}

/**
 * Whether the brake stops an overwind in the room the headgear leaves.
 *
 * An overwind is the rising conveyance going past the bank, so it is
 * the winding figure that answers it, against what the room and the
 * speed between them demand.
 */
export function stopsAnOverwind(of: Winder): boolean {
  return retardationWinding(of) >= retardationFor(of.profile.full, overwindRoom(of.shaft));
}

/**
 * What one shoe presses at, in newtons a square millimetre.
 *
 * The force over the strip of path the shoe covers, which is an arc and
 * not a rectangle: a shoe on a small path with a wide arc is a shoe
 * with a great deal of area, and the same spring behind it presses far
 * more gently.
 */
export function pressure(one: Brake): number {
  const swept = Math.PI * one.diameter * (one.arc / 360) * one.width;
  insist(swept > 0, "that shoe covers nothing at all", "arc");
  return round(one.force / (swept * 1000), 4);
}

/**
 * Where in the wind the out-of-balance is at its worst, in metres still
 * to go.
 *
 * Nought is the end of the wind and the whole depth is the start, which
 * is how `power` measures a position and how an engineman thinks about
 * one. On a winder with a matched balance rope the answer is arbitrary,
 * because every point of the wind is the same point.
 */
export function worstPoint(of: Winder): number {
  const what = dutyOf(of);
  const depth = windLength(of);
  let worst = 0;
  let found = 0;
  for (let at = 0; at <= 100; at += 1) {
    const where = (depth * at) / 100;
    const size = Math.abs(outOfBalance(what, where));
    if (size > worst) {
      worst = size;
      found = where;
    }
  }
  return round(found, 2);
}

/**
 * The path diameter that would hold it, with the shoes as they are, in
 * metres.
 *
 * The other lever, and on an old winder the only one left: springs can
 * be wound up until the pins bend and the lining will not take more
 * pressure, but a path can be built out to the rim of the drum and
 * often has been, which is why so many drums are wider at the cheek
 * than the coiling needs.
 */
export function pathFor(of: Winder, margin = HOLDING_MARGIN): number {
  positive(margin, "margin");
  const one = brakeOf(of);
  const wanted = margin * worstOutOfBalance(dutyOf(of)) * dutyOf(of).radius;
  return round((2 * wanted) / (one.friction * one.force * one.shoes), 3);
}

/** How many shoes it wants, with the path and the springs as they are. */
export function shoesFor(of: Winder, margin = HOLDING_MARGIN): number {
  positive(margin, "margin");
  const one = brakeOf(of);
  const wanted = margin * worstOutOfBalance(dutyOf(of)) * dutyOf(of).radius;
  return Math.ceil(wanted / (one.friction * one.force * (one.diameter / 2)));
}

/**
 * Whether the ropes give way before the shoes do.
 *
 * The question that decides which end of a friction winder to spend
 * money on. Where the ropes go first, a heavier spring buys nothing at
 * all and the answer is wrap, or lining, or a balance rope; where the
 * shoes go first the brake is simply small.
 */
export function slipsFirst(of: Winder): boolean {
  if (of.drive.kind === "drum") return false;
  return gripPull(of) < holdingPull(of);
}

/**
 * How far a lowering wind runs on before it stops, in metres.
 *
 * From full speed, with the brake's own lowering retardation and the
 * half second the shoes take to come on. It is the figure to set beside
 * the sump, because a lowering wind that will not stop in the room
 * below the lowest inset stops in the water.
 */
export function stoppingRoom(of: Winder): number {
  const found = retardationLowering(of);
  insist(found > 0, "that brake does not stop a lowering wind at all", "brake");
  return stoppingDistance(of.profile.full, found);
}

/** Whether the shoe is pressed no harder than practice allows. */
export function pressureStands(one: Brake, most = MOST_SHOE_PRESSURE): boolean {
  positive(most, "most");
  return pressure(one) <= most;
}

/**
 * The power the shoes take at full speed, in kilowatts.
 *
 * What the path has to get rid of while a stop is going on, as against
 * the energy of the whole stop. A winder braked from sixteen metres a
 * second turns several thousand kilowatts into heat for a second or
 * two, which is more than the motor puts in and is the reason a brake
 * path is a casting and not a plate.
 */
export function dragPower(of: Winder): number {
  return round(heldPull(of) * of.profile.full, 2);
}

/**
 * Whether the brake holds at one stated point of the wind rather than
 * at the worst of it.
 *
 * The position is metres still to go, as everywhere else. Worth asking
 * where a winder is being worked to a shallow inset on a machine built
 * for the sump, since the out-of-balance it sees there is not the one
 * the brake was set for.
 */
export function holdsAt(of: Winder, at: number, margin = HOLDING_MARGIN): boolean {
  positive(margin, "margin");
  const load = Math.abs(outOfBalance(dutyOf(of), at));
  return heldPull(of) >= margin * load;
}

/**
 * The band a friction winder's shoe force has to sit inside, in
 * kilonewtons.
 *
 * Below the low end the brake will not hold the wind standing; above
 * the high end the shoes are dragging harder than the ropes grip, so
 * every extra newton of spring goes into the lining and none of it into
 * stopping anything. A band that comes out the wrong way round is a
 * winder that cannot be braked as it stands, and the cure is wrap or a
 * balance rope rather than springs.
 */
export function brakeBand(of: Winder): { readonly low: number; readonly high: number } {
  insist(of.drive.kind === "koepe", "a drum winder has no upper end to its brake force", "drive");
  const one = brakeOf(of);
  const low = forceFor(of);
  const high = (gripPull(of) * dutyOf(of).radius) / (one.friction * one.shoes * (one.diameter / 2));
  return { low: round(low, 4), high: round(high, 4) };
}

/**
 * The speed the overspeed gear should watch for at a stated distance
 * from the landing, in metres a second.
 *
 * `gear` draws that curve from a retardation somebody assumed. This
 * draws it from the brake actually bolted to the machine, and on a
 * winder whose brake is worse than the assumption the two curves are
 * far enough apart to matter: the gear passes a wind it cannot stop and
 * says nothing, which is the failure the curve was invented to prevent.
 */
export function curveFrom(of: Winder, toGo: number): number {
  nonNegative(toGo, "toGo");
  const found = retardationLowering(of);
  insist(found > 0, "that brake does not stop a lowering wind at all", "brake");
  return curveSpeed(toGo, found);
}

/**
 * The same brake with a glazed lining, as a brake.
 *
 * A lining does not wear out so much as polish, and a polished lining
 * grips at a fraction of what it did on the day of the test. The share
 * is how much of the friction has gone: a fifth is an ordinary winter,
 * and a half is a lining that has had oil on it.
 */
export function glazed(one: Brake, lost: number): Brake {
  within(lost, 0, 1, "lost");
  return brake({ ...one, friction: one.friction * (1 - lost) });
}

/**
 * How much friction a brake can lose and still hold the wind, as a
 * share.
 *
 * The figure worth writing on the certificate, because it says what the
 * margin is actually for. A brake holding at exactly three times has
 * nothing to lose and will fail the first time somebody spills oil on
 * the path; one holding at four times can lose a quarter of its lining
 * and nobody ever finds out.
 */
export function canLose(of: Winder, margin = HOLDING_MARGIN): number {
  positive(margin, "margin");
  const worst = worstOutOfBalance(dutyOf(of));
  insist(worst > 0, "that winder is in perfect balance and needs no brake to hold it", "brake");
  const spare = 1 - (margin * worst) / heldPull(of);
  return round(Math.max(0, spare), 4);
}

/**
 * The speed a lowering wind can be running at and still be stopped in
 * the sump, in metres a second.
 *
 * The other end of the shaft from the overwind and the one nobody
 * builds a headgear for. An underwind has whatever the sump gives it
 * and no more, and the brake it is stopped by is the weaker of the two
 * figures rather than the stronger.
 */
export function stoppableLowering(of: Winder): number {
  const found = retardationLowering(of);
  insist(found > 0, "that brake does not stop a lowering wind at all", "brake");
  const room = of.shaft.sump;
  positive(room, "sump");
  // Solving the stopping distance for the speed, the half second the
  // shoes take to come on included.
  const delay = 0.5;
  const factor = 1 / (2 * found);
  const speed = (-delay + Math.sqrt(delay * delay + 4 * factor * room)) / (2 * factor);
  return round(Math.max(0, speed), 3);
}

/**
 * The deepest wind this brake still holds, in metres.
 *
 * Walked in tens, because the answer is wanted to the nearest ten
 * metres and the out-of-balance it is walking against is not a straight
 * line in anything a colliery can measure. A winder that comes out
 * shallower than its own shaft is a winder whose brake was specified
 * for the seam above the one it is working.
 */
export function deepestBraked(of: Winder, margin = HOLDING_MARGIN): number {
  positive(margin, "margin");
  const pull = heldPull(of);
  const metre = weightOf(massPerMetre(of.rope) * of.ropes - of.balance);
  const conveyances = weightOf(gross(of.rising) - of.falling.tare - of.falling.payload);
  insist(pull > margin * conveyances, "that brake will not hold the conveyances at any depth", "brake");
  let best = 0;
  for (let at = 0; at <= 4000; at += 10) {
    const worst = Math.abs(conveyances + metre * at);
    if (pull >= margin * worst) best = at;
  }
  return best;
}

/** The brake in a line, for a report. */
export function describeBrake(of: Winder): string {
  const one = brakeOf(of);
  return (
    `${one.shoes} shoes on a ${one.diameter} m path: ${torque(one)} kNm, ${heldPull(of)} kN at the rope ` +
    `against ${worstOutOfBalance(dutyOf(of))} kN out of balance, ${retardationLowering(of)} m/s² lowering`
  );
}

/** How much of the holding margin the brake actually has, as a ratio. */
export function holdingMargin(of: Winder): number {
  const worst = worstOutOfBalance(dutyOf(of));
  insist(worst > 0, "that winder is in perfect balance and needs no brake to hold it", "brake");
  return round(heldPull(of) / worst, 3);
}

/**
 * What one stop from full speed puts into the path, in megajoules a
 * square metre of lining.
 *
 * The figure a lining is chosen on rather than the pressure, and the
 * reason a winder that stops twice a shift and one that stops twice an
 * hour do not take the same shoes.
 */
export function stopHeat(of: Winder): number {
  const one = brakeOf(of);
  nonNegative(of.profile.full, "full");
  const kinetic = (movingMass(dutyOf(of)) * of.profile.full * of.profile.full) / 2;
  const swept = Math.PI * one.diameter * (one.arc / 360) * one.width * one.shoes;
  insist(swept > 0, "that brake covers no path at all", "arc");
  return round(kinetic / swept / 1_000_000, 4);
}
