import type { Calibre } from "../catalog/calibre.js";
import { apogeeFor, riseTimeFor } from "../catalog/lift.js";
import { clamp } from "../core/numeric.js";
import type { Metres, Milliseconds } from "../core/units.js";
import { metres, ms, raw } from "../core/units.js";

/**
 * Where the shell actually is.
 *
 * The lift table gives two numbers, apogee and the time to reach it. Plenty of
 * questions need the whole curve instead. How high is it when the next shell
 * is fired, is it above the treeline yet, where is it when the wind starts
 * pushing on it.
 *
 * The model is a vertical launch with quadratic drag, integrated with a fixed
 * step. It is not a wind tunnel. What it is, is consistent with the lift
 * table, because the drag coefficient is fitted per calibre so that the
 * integration reaches the tabulated apogee at the tabulated time. That means
 * the curve and the table never disagree, which matters more than either being
 * exactly right.
 */

const GRAVITY = 9.80665;
const STEP_MS = 10;

export interface TrajectoryPoint {
  readonly at: Milliseconds;
  readonly height: Metres;
  /** Vertical speed, positive upward. */
  readonly speed: number;
}

export interface Trajectory {
  readonly points: readonly TrajectoryPoint[];
  readonly apogee: Metres;
  readonly apogeeAt: Milliseconds;
  /** The drag term fitted to make this curve agree with the lift table. */
  readonly drag: number;
}

function integrate(
  launchSpeed: number,
  drag: number,
  untilMs: number,
): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  let height = 0;
  let speed = launchSpeed;
  const step = STEP_MS / 1000;
  for (let t = 0; t <= untilMs; t += STEP_MS) {
    points.push({ at: ms(t), height: metres(Math.max(0, height)), speed });
    const resistance = drag * speed * Math.abs(speed);
    speed += (-GRAVITY - resistance) * step;
    height += speed * step;
    if (height < 0) {
      break;
    }
  }
  return points;
}

function apogeeOf(points: readonly TrajectoryPoint[]): {
  height: number;
  at: number;
} {
  let best = 0;
  let bestAt = 0;
  for (const point of points) {
    if (raw(point.height) > best) {
      best = raw(point.height);
      bestAt = raw(point.at);
    }
  }
  return { height: best, at: bestAt };
}

/**
 * Fit both the launch speed and the drag term so the curve reaches the
 * tabulated apogee at the tabulated time.
 *
 * Two unknowns and two targets, and both relationships are monotonic, so a
 * binary search inside a binary search converges without any cleverness. The
 * inner search picks the speed that reaches the wanted height for a given
 * drag; the outer one picks the drag that makes it get there at the wanted
 * time. More drag means a steeper climb and an earlier apogee for the same
 * height, which is what makes the outer search well behaved.
 */
function fitLaunchSpeed(drag: number, wantedApogee: number): number {
  let low = 10;
  let high = 400;
  for (let i = 0; i < 22; i += 1) {
    const middle = (low + high) / 2;
    if (apogeeOf(integrate(middle, drag, 30000)).height < wantedApogee) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

interface Fit {
  readonly launchSpeed: number;
  readonly drag: number;
}

function fitCurve(wantedApogee: number, wantedRiseMs: number): Fit {
  let low = 0;
  let high = 0.02;
  let launchSpeed = fitLaunchSpeed(0, wantedApogee);
  for (let i = 0; i < 20; i += 1) {
    const middle = (low + high) / 2;
    launchSpeed = fitLaunchSpeed(middle, wantedApogee);
    const reachedAt = apogeeOf(integrate(launchSpeed, middle, 30000)).at;
    if (reachedAt > wantedRiseMs) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const drag = (low + high) / 2;
  return { launchSpeed: fitLaunchSpeed(drag, wantedApogee), drag };
}

export function trajectoryFor(value: Calibre): Trajectory {
  const wanted = raw(apogeeFor(value));
  const rise = raw(riseTimeFor(value));
  const fit = fitCurve(wanted, rise);
  const points = integrate(
    fit.launchSpeed,
    fit.drag,
    Math.max(rise * 3, 20000),
  );
  const top = apogeeOf(points);
  return {
    points,
    apogee: metres(top.height),
    apogeeAt: ms(top.at),
    drag: fit.drag,
  };
}

/** Height at a moment after launch, interpolated between integration steps. */
export function heightAt(trajectory: Trajectory, at: Milliseconds): Metres {
  const want = raw(at);
  if (want <= 0) {
    return metres(0);
  }
  const points = trajectory.points;
  const index = Math.floor(want / STEP_MS);
  const low = points[index];
  const high = points[index + 1];
  if (low === undefined) {
    return metres(0);
  }
  if (high === undefined) {
    return low.height;
  }
  const t = clamp((want - raw(low.at)) / STEP_MS, 0, 1);
  return metres(raw(low.height) + (raw(high.height) - raw(low.height)) * t);
}

export function speedAt(trajectory: Trajectory, at: Milliseconds): number {
  const index = Math.floor(Math.max(0, raw(at)) / STEP_MS);
  return trajectory.points[index]?.speed ?? 0;
}

/** When the shell first passes a height on the way up, if it ever does. */
export function timeToHeight(
  trajectory: Trajectory,
  height: Metres,
): Milliseconds | undefined {
  const wanted = raw(height);
  for (const point of trajectory.points) {
    if (raw(point.height) >= wanted) {
      return point.at;
    }
    if (point.speed < 0) {
      break;
    }
  }
  return undefined;
}

/** How long the whole flight lasts, launch to ground. */
export function flightTime(trajectory: Trajectory): Milliseconds {
  const last = trajectory.points[trajectory.points.length - 1];
  return last?.at ?? ms(0);
}

/**
 * Whether the fitted curve agrees with the lift table it was fitted to. This
 * exists so the agreement is a tested property rather than an assumption, and
 * so a change to the lift table cannot silently break the model.
 */
export function agreesWithTable(value: Calibre, toleranceMetres = 8): boolean {
  const trajectory = trajectoryFor(value);
  return (
    Math.abs(raw(trajectory.apogee) - raw(apogeeFor(value))) <= toleranceMetres
  );
}
