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

/**
 * A noise sensitive property: the nearest house, school or ward, and the peak
 * level the licence allows there when one has been written down.
 */
export interface House {
  readonly name: string;
  readonly at: Point;
  /** Peak level allowed there, in decibels, when the licence names one. */
  readonly limit?: number;
}

export interface Site {
  readonly name: string;
  /** The line the audience stands behind. */
  readonly spectatorLine: Boundary;
  /** Rivers, roads, hedges, buildings. */
  readonly boundaries: readonly Boundary[];
  /** The properties the noise is measured at. */
  readonly houses: readonly House[];
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
  houses: readonly House[] = [],
): Site {
  return { name, spectatorLine, boundaries, houses };
}

export function house(
  name: string,
  east: number,
  north: number,
  limit?: number,
): House {
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new RangeError(`a noise limit of ${limit} at ${name} makes no sense`);
  }
  const built: { name: string; at: Point; limit?: number } = {
    name,
    at: point(east, north),
  };
  if (limit !== undefined) {
    built.limit = limit;
  }
  return built;
}

/**
 * A house as something the noise model can measure to. The model measures to
 * a boundary, and a boundary of two equal points is a point.
 */
export function houseBoundary(property: House): Boundary {
  return boundary(property.name, [property.at, property.at]);
}

/** Only the boundaries nothing may land past. */
export function hardBoundaries(where: Site): Boundary[] {
  return where.boundaries.filter((line) => line.hard);
}

function orientation(o: Point, a: Point, b: Point): number {
  return (
    (a.east - o.east) * (b.north - o.north) -
    (a.north - o.north) * (b.east - o.east)
  );
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    Math.min(a.east, b.east) <= p.east &&
    p.east <= Math.max(a.east, b.east) &&
    Math.min(a.north, b.north) <= p.north &&
    p.north <= Math.max(a.north, b.north)
  );
}

/**
 * Whether two segments meet, touching included. The classic orientation test,
 * with the collinear cases handled rather than ignored, because a boundary
 * drawn straight along a grid line is the common case on a surveyed site.
 */
export function segmentsCross(p: Point, q: Point, a: Point, b: Point): boolean {
  const d1 = orientation(p, q, a);
  const d2 = orientation(p, q, b);
  const d3 = orientation(a, b, p);
  const d4 = orientation(a, b, q);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (d1 === 0 && onSegment(a, p, q)) {
    return true;
  }
  if (d2 === 0 && onSegment(b, p, q)) {
    return true;
  }
  if (d3 === 0 && onSegment(p, a, b)) {
    return true;
  }
  return d4 === 0 && onSegment(q, a, b);
}

/** Whether a straight flight from one point to another crosses a boundary. */
export function flightCrosses(from: Point, to: Point, line: Boundary): boolean {
  for (let i = 1; i < line.points.length; i += 1) {
    const a = line.points[i - 1];
    const b = line.points[i];
    if (a !== undefined && b !== undefined && segmentsCross(from, to, a, b)) {
      return true;
    }
  }
  return false;
}

/**
 * The hard boundaries a landing breaks. Debris lands in a disc round wherever
 * the wind carried it, so a line is crossed when that disc reaches it, and
 * also when the disc came down beyond it: the flight from the mortar to the
 * centre of the disc went over the line, and everything under that flight
 * path is where the debris was on the way.
 */
export function landingCrosses(
  from: Point,
  centre: Point,
  radius: Metres,
  where: Site,
): string[] {
  return hardBoundaries(where)
    .filter(
      (line) =>
        raw(distanceToBoundary(centre, line)) < raw(radius) ||
        flightCrosses(from, centre, line),
    )
    .map((line) => line.name);
}
