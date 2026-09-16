import type { Point } from "./site.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { clamp } from "../core/numeric.js";
import type { Metres, MetresPerSecond, Milliseconds } from "../core/units.js";
import { metres, metresPerSecond, ms, raw } from "../core/units.js";

/**
 * Where the fallout actually lands.
 *
 * A spent casing leaves apogee with no upward speed and comes down at whatever
 * terminal velocity its shape gives it, which for a paper shell is around ten
 * metres a second. On the way down it goes wherever the wind is going. A six
 * inch shell breaking at a hundred and eighty metres is falling for the better
 * part of twenty seconds, so eight metres a second of wind moves its debris
 * more than a hundred and forty metres downwind.
 *
 * That number is larger than most people expect and it is the reason the
 * fallout disc is drawn offset rather than centred. A crew that centres it is
 * clearing the wrong half of the field.
 */

/** Wind above this and nothing goes up, the figure both codes settle on. */
export const HOLD_SPEED: MetresPerSecond = metresPerSecond(13.4);

/** Above this the crew should be reconsidering the large shells. */
export const CAUTION_SPEED: MetresPerSecond = metresPerSecond(9);

export interface Wind {
  readonly speed: MetresPerSecond;
  /** Direction the wind is blowing towards, in degrees clockwise from north. */
  readonly towards: number;
}

export function wind(speed: MetresPerSecond, towards: number): Wind {
  if (!Number.isFinite(towards)) {
    throw new RangeError("wind direction has to be a number of degrees");
  }
  return { speed, towards: ((towards % 360) + 360) % 360 };
}

/**
 * How fast spent casing comes down. Paper and card shells tumble and settle
 * around ten metres a second. A plastic hemisphere that fails to open comes
 * down a good deal faster, which is why a dud is treated separately.
 */
export const CASING_DESCENT: MetresPerSecond = metresPerSecond(10);
export const DUD_DESCENT: MetresPerSecond = metresPerSecond(28);

export function descentTime(
  from: Metres,
  rate: MetresPerSecond = CASING_DESCENT,
): Milliseconds {
  if (raw(rate) <= 0) {
    throw new RangeError("a descent rate has to be above zero");
  }
  return ms((raw(from) / raw(rate)) * 1000);
}

/** How far downwind debris travels falling from a height. */
export function driftDistance(
  from: Metres,
  air: Wind,
  rate: MetresPerSecond = CASING_DESCENT,
): Metres {
  const seconds = raw(descentTime(from, rate)) / 1000;
  return metres(seconds * raw(air.speed));
}

/** Where the fallout disc's centre moves to, given the wind. */
export function driftedCentre(
  from: Point,
  height: Metres,
  air: Wind,
  rate: MetresPerSecond = CASING_DESCENT,
): Point {
  const distance = raw(driftDistance(height, air, rate));
  const radians = (air.towards * Math.PI) / 180;
  return {
    east: from.east + distance * Math.sin(radians),
    north: from.north + distance * Math.cos(radians),
  };
}

/**
 * The radius a fallout disc has to grow to if it is to stay centred on the
 * firing point rather than being drawn offset. This is the conservative form,
 * and it is what a permit drawing usually shows.
 */
export function inflatedRadius(
  base: Metres,
  height: Metres,
  air: Wind,
  rate: MetresPerSecond = CASING_DESCENT,
): Metres {
  return metres(raw(base) + raw(driftDistance(height, air, rate)));
}

export type WindVerdict = "clear" | "caution" | "hold";

export function windVerdict(air: Wind): WindVerdict {
  const speed = raw(air.speed);
  if (speed >= raw(HOLD_SPEED)) {
    return "hold";
  }
  return speed >= raw(CAUTION_SPEED) ? "caution" : "clear";
}

/**
 * The largest break height that keeps drift inside a given allowance. This is
 * the useful direction of the calculation on a windy evening, because the
 * question is never how far a twelve inch will drift, it is what the crew can
 * still shoot.
 */
export function maxHeightFor(
  allowance: Metres,
  air: Wind,
  rate: MetresPerSecond = CASING_DESCENT,
): Metres {
  const speed = raw(air.speed);
  if (speed <= 0) {
    return metres(Number.MAX_SAFE_INTEGER);
  }
  return metres((raw(allowance) * raw(rate)) / speed);
}

export interface WindCheck {
  /** How far clear of the audience the nearest firing position sits. */
  readonly allowance: Metres;
  readonly worstHeight: Metres;
}

export function checkWind(air: Wind, check: WindCheck): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const verdict = windVerdict(air);
  if (verdict === "hold") {
    diagnostics.error({
      code: "PF4000",
      message: `wind is ${raw(air.speed).toFixed(1)}m/s, at or over the ${raw(HOLD_SPEED)}m/s hold`,
      help: "nothing goes up until it drops",
    });
    return diagnostics;
  }
  if (verdict === "caution") {
    diagnostics.warning({
      code: "PF4001",
      message: `wind is ${raw(air.speed).toFixed(1)}m/s, inside the caution band`,
    });
  }
  const drift = raw(driftDistance(check.worstHeight, air));
  if (drift > raw(check.allowance)) {
    diagnostics.error({
      code: "PF4002",
      message: `debris from ${raw(check.worstHeight)}m drifts ${drift.toFixed(0)}m and there is ${raw(check.allowance).toFixed(0)}m of room`,
      help: "lower the breaks, move the rack upwind, or drop the large shells",
    });
  } else if (drift > raw(check.allowance) * 0.75) {
    diagnostics.warning({
      code: "PF4003",
      message: `debris drifts ${drift.toFixed(0)}m into ${raw(check.allowance).toFixed(0)}m of room`,
    });
  }
  return diagnostics;
}

/** Compass name for a direction, for a report a crew reads out loud. */
export function compassName(degrees: number): string {
  const names = [
    "north",
    "north east",
    "east",
    "south east",
    "south",
    "south west",
    "west",
    "north west",
  ];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return names[index] ?? "north";
}

export function describeWind(air: Wind): string {
  const speed = raw(air.speed).toFixed(1);
  return `${speed}m/s towards the ${compassName(air.towards)}, ${windVerdict(air)}`;
}

/** Clamp a measured gust into something the model can use. */
export function usableSpeed(measured: number): MetresPerSecond {
  return metresPerSecond(clamp(measured, 0, 60));
}
