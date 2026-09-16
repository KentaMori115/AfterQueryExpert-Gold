import { DiagnosticBag } from "../core/diagnostic.js";
import { keyValueTable } from "../core/text.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { Metres } from "../core/units.js";
import type { Boundary, Point } from "./site.js";
import { distanceToSegment } from "./site.js";

/**
 * How many people the viewing area holds.
 *
 * This is not a pyrotechnic question and it is the one that most often stops a
 * display. The separation distance decides where the audience line goes, and
 * where the line goes decides how much ground is behind it, and that decides
 * how many people can stand there. A display designed for a field that turns
 * out to hold four thousand people when eight thousand are expected is a
 * crowd problem rather than a fireworks problem, and it surfaces late.
 *
 * The densities are the ones the crowd safety guidance uses. Two people per
 * square metre is comfortable standing, four is dense and still safe on flat
 * ground, and past that it stops being a viewing area.
 */

export type CrowdDensity = "seated" | "comfortable" | "dense" | "packed";

/** People per square metre. */
export const DENSITIES: Record<CrowdDensity, number> = {
  seated: 1,
  comfortable: 2,
  dense: 4,
  packed: 5,
};

export interface ViewingArea {
  /** Length of the audience line, in metres. */
  readonly frontage: Metres;
  /** How far back the viewing area runs from the line. */
  readonly depth: Metres;
}

export function areaOf(area: ViewingArea): number {
  return raw(area.frontage) * raw(area.depth);
}

export function capacityFor(
  area: ViewingArea,
  density: CrowdDensity = "comfortable",
): number {
  return Math.floor(areaOf(area) * DENSITIES[density]);
}

/** Frontage of a boundary, which is what an audience line usually is. */
export function frontageOf(line: Boundary): number {
  let total = 0;
  for (let i = 1; i < line.points.length; i += 1) {
    const from = line.points[i - 1];
    const to = line.points[i];
    if (from !== undefined && to !== undefined) {
      total += Math.hypot(to.east - from.east, to.north - from.north);
    }
  }
  return total;
}

export interface CrowdPlan {
  readonly expected: number;
  readonly area: ViewingArea;
  readonly density: CrowdDensity;
  /** How many exits the viewing area has. */
  readonly exits?: number;
  /** People per minute one exit clears, the usual planning figure. */
  readonly exitRate?: number;
}

/** People per minute a single exit clears on the flat. */
export const EXIT_RATE_PER_MINUTE = 82;

export interface CrowdVerdict {
  readonly capacity: number;
  readonly expected: number;
  readonly headroom: number;
  readonly densityAtExpected: number;
  readonly clearanceMinutes?: number;
}

export function crowdVerdict(plan: CrowdPlan): CrowdVerdict {
  const capacity = capacityFor(plan.area, plan.density);
  const area = areaOf(plan.area);
  const verdict: {
    capacity: number;
    expected: number;
    headroom: number;
    densityAtExpected: number;
    clearanceMinutes?: number;
  } = {
    capacity,
    expected: plan.expected,
    headroom: capacity - plan.expected,
    densityAtExpected: area === 0 ? 0 : plan.expected / area,
  };
  if (plan.exits !== undefined && plan.exits > 0) {
    const rate = plan.exitRate ?? EXIT_RATE_PER_MINUTE;
    verdict.clearanceMinutes = plan.expected / (plan.exits * rate);
  }
  return verdict;
}

export function checkCrowd(plan: CrowdPlan): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const verdict = crowdVerdict(plan);

  if (verdict.headroom < 0) {
    diagnostics.error({
      code: "PF4300",
      message: `the viewing area holds ${verdict.capacity} and ${verdict.expected} are expected`,
      help: "widen the frontage, move the line back, or cap the numbers",
    });
  } else if (verdict.headroom < verdict.capacity * 0.1) {
    diagnostics.warning({
      code: "PF4301",
      message: `the viewing area holds ${verdict.capacity} and ${verdict.expected} are expected`,
    });
  }

  if (verdict.densityAtExpected > DENSITIES.dense) {
    diagnostics.error({
      code: "PF4302",
      message: `that is ${verdict.densityAtExpected.toFixed(1)} people per square metre`,
      help: "past four per square metre it stops being a viewing area",
    });
  }

  if (plan.exits === undefined || plan.exits === 0) {
    diagnostics.warning({
      code: "PF4303",
      message: "no exits are given, so the area cannot be shown to clear",
    });
  } else if (
    verdict.clearanceMinutes !== undefined &&
    verdict.clearanceMinutes > 8
  ) {
    diagnostics.warning({
      code: "PF4304",
      message: `clearing ${plural(plan.expected, "person", "people")} through ${plural(plan.exits, "exit")} takes ${verdict.clearanceMinutes.toFixed(0)} minutes`,
      help: "eight minutes is the usual planning figure for a full clearance",
    });
  }
  return diagnostics;
}

/**
 * How deep the viewing area has to be for a crowd, given the frontage the site
 * offers. This is the direction the question is usually asked in, because the
 * frontage is fixed by the field and the depth is what a plan can move.
 */
export function depthNeeded(
  expected: number,
  frontage: Metres,
  density: CrowdDensity = "comfortable",
): number {
  const width = raw(frontage);
  if (width <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return expected / (width * DENSITIES[density]);
}

/** Whether a point sits inside the viewing area behind a straight line. */
export function insideViewingArea(
  point: Point,
  line: Boundary,
  depth: Metres,
): boolean {
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.points.length; i += 1) {
    const from = line.points[i - 1];
    const to = line.points[i];
    if (from !== undefined && to !== undefined) {
      closest = Math.min(closest, distanceToSegment(point, from, to));
    }
  }
  return closest <= raw(depth);
}

export function describeCrowd(plan: CrowdPlan): string {
  const verdict = crowdVerdict(plan);
  const rows: [string, string][] = [
    ["frontage", `${raw(plan.area.frontage).toFixed(0)}m`],
    ["depth", `${raw(plan.area.depth).toFixed(0)}m`],
    ["area", `${areaOf(plan.area).toFixed(0)} square metres`],
    ["density", `${plan.density}, ${DENSITIES[plan.density]} per square metre`],
    ["capacity", String(verdict.capacity)],
    ["expected", String(verdict.expected)],
    ["headroom", String(verdict.headroom)],
  ];
  if (verdict.clearanceMinutes !== undefined) {
    rows.push(["clearance", `${verdict.clearanceMinutes.toFixed(1)} minutes`]);
  }
  return keyValueTable(rows, ["item", "value"]);
}
