import type { Metres } from "../core/units.js";
import { metres, raw } from "../core/units.js";
import type { FiringPosition } from "../rig/rig.js";

/**
 * The shape of the ground.
 *
 * A site is not a circle round a firing point, however often it is drawn that
 * way. It is a set of firing positions, a line the audience stands behind, and
 * usually a river, a road or a hedge that the fallout must not cross. The
 * spectator line is a polyline rather than a straight edge, because the useful
 * case is a curved barrier round one side of a field and the straight case
 * falls out of it for free.
 *
 * Coordinates are metres east and north of a site origin the crew picks, which
 * is normally the first mortar rack. Nothing here knows about latitude, and
 * that is deliberate. A display site is a few hundred metres across and a flat
 * local frame is exact enough at that scale, while a spherical one would add a
 * projection choice for no gain.
 */

export interface Point {
  readonly east: number;
  readonly north: number;
}

export interface Boundary {
  readonly name: string;
  /** Ordered points. Two make a straight edge, more make a polyline. */
  readonly points: readonly Point[];
  /** Nothing may land beyond this line, not just no spectator may stand there. */
  readonly hard: boolean;
}

export interface Site {
  readonly name: string;
  /** The line the audience stands behind. */
  readonly spectatorLine: Boundary;
  /** Rivers, roads, hedges, buildings. */
  readonly boundaries: readonly Boundary[];
}

export function point(east: number, north: number): Point {
  if (!Number.isFinite(east) || !Number.isFinite(north)) {
    throw new RangeError("a site point needs finite coordinates");
  }
  return { east, north };
}

export function boundary(
  name: string,
  points: readonly Point[],
  hard = false,
): Boundary {
  if (points.length < 2) {
    throw new RangeError(`boundary ${name} needs at least two points`);
  }
  return { name, points, hard };
}

/** Shortest distance from a point to a segment, including its endpoints. */
export function distanceToSegment(from: Point, a: Point, b: Point): number {
  const dx = b.east - a.east;
  const dy = b.north - a.north;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(from.east - a.east, from.north - a.north);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((from.east - a.east) * dx + (from.north - a.north) * dy) / lengthSquared,
    ),
  );
  const nearestEast = a.east + t * dx;
  const nearestNorth = a.north + t * dy;
  return Math.hypot(from.east - nearestEast, from.north - nearestNorth);
}

export function distanceToBoundary(from: Point, line: Boundary): Metres {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.points.length; i += 1) {
    const a = line.points[i - 1];
    const b = line.points[i];
    if (a === undefined || b === undefined) {
      continue;
    }
    best = Math.min(best, distanceToSegment(from, a, b));
  }
  return metres(Number.isFinite(best) ? best : 0);
}

export function positionPoint(position: FiringPosition): Point {
  return { east: position.east, north: position.north };
}

/** The closest a firing position sits to the audience. */
export function distanceToAudience(
  position: FiringPosition,
  site: Site,
): Metres {
  return distanceToBoundary(positionPoint(position), site.spectatorLine);
}

export interface BoundaryClearance {
  readonly boundary: string;
  readonly distance: Metres;
  readonly hard: boolean;
}

export function clearances(
  position: FiringPosition,
  site: Site,
): BoundaryClearance[] {
  const here = positionPoint(position);
  return [site.spectatorLine, ...site.boundaries]
    .map((line) => ({
      boundary: line.name,
      distance: distanceToBoundary(here, line),
      hard: line.hard,
    }))
    .sort((a, b) => raw(a.distance) - raw(b.distance));
}

/** The tightest clearance anywhere on the site, which is what a permit quotes. */
export function tightestClearance(
  positions: Iterable<FiringPosition>,
  site: Site,
):
  | { readonly position: string; readonly clearance: BoundaryClearance }
  | undefined {
  let best: { position: string; clearance: BoundaryClearance } | undefined;
  for (const position of positions) {
    for (const clearance of clearances(position, site)) {
      if (
        best === undefined ||
        raw(clearance.distance) < raw(best.clearance.distance)
      ) {
        best = { position: position.id, clearance };
      }
    }
  }
  return best;
}

/**
 * Whether a fallout disc of the given radius stays inside every hard
 * boundary. Soft boundaries are the audience line, which is handled by the
 * separation rule; hard ones are the river the parish will not let anything
 * land in.
 */
export function falloutClears(
  position: FiringPosition,
  site: Site,
  falloutRadius: Metres,
): string[] {
  const here = positionPoint(position);
  return site.boundaries
    .filter(
      (line) =>
        line.hard && raw(distanceToBoundary(here, line)) < raw(falloutRadius),
    )
    .map((line) => line.name);
}

/** A straight audience line, the common case, written as one call. */
export function straightLine(name: string, from: Point, to: Point): Boundary {
  return boundary(name, [from, to]);
}

export function site(
  name: string,
  spectatorLine: Boundary,
  boundaries: readonly Boundary[] = [],
): Site {
  return { name, spectatorLine, boundaries };
}
