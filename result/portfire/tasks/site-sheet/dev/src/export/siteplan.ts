import { clamp } from "../core/numeric.js";
import { distinct } from "../core/collect.js";
import { raw } from "../core/units.js";
import type { Rig } from "../rig/rig.js";
import type { Boundary, Point, Site } from "../safety/site.js";
import { separationForEffect } from "../safety/distance.js";
import type { DistanceRule } from "../safety/distance.js";
import { landingOf } from "../safety/rules.js";
import type { Wind } from "../safety/wind.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";

/**
 * A site plan you can paste into an email.
 *
 * A proper site plan is a drawing, and this is not one. What it is, is a
 * picture of the same numbers, drawn on the same grid, that fits in a text
 * file and cannot get out of step with the show it came from. Half the value
 * of a site plan is catching the position somebody typed in with the sign
 * wrong, and a character grid catches that as well as a drawing does.
 *
 * North is up, east is right, and the audience is drawn wherever it actually
 * is rather than assumed to be at the bottom, because plenty of sites shoot
 * over the audience's left shoulder.
 */

export interface PlanOptions {
  readonly width?: number;
  readonly height?: number;
  /** Draw a ring at each position showing its separation distance. */
  readonly rings?: boolean;
  readonly rule?: DistanceRule;
  /**
   * Draw where each position's widest fallout disc actually lands. Under a
   * wind the disc sits downwind of the letter, which is the picture a crew
   * clearing the field needs and the one a centred ring gets wrong.
   */
  readonly fallout?: boolean;
  readonly wind?: Wind;
}

interface Bounds {
  readonly minEast: number;
  readonly maxEast: number;
  readonly minNorth: number;
  readonly maxNorth: number;
}

function boundsOf(points: readonly Point[]): Bounds {
  let minEast = Number.POSITIVE_INFINITY;
  let maxEast = Number.NEGATIVE_INFINITY;
  let minNorth = Number.POSITIVE_INFINITY;
  let maxNorth = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minEast = Math.min(minEast, point.east);
    maxEast = Math.max(maxEast, point.east);
    minNorth = Math.min(minNorth, point.north);
    maxNorth = Math.max(maxNorth, point.north);
  }
  if (!Number.isFinite(minEast)) {
    return { minEast: -10, maxEast: 10, minNorth: -10, maxNorth: 10 };
  }
  // Pad so nothing sits exactly on the frame.
  const padEast = Math.max(5, (maxEast - minEast) * 0.1);
  const padNorth = Math.max(5, (maxNorth - minNorth) * 0.1);
  return {
    minEast: minEast - padEast,
    maxEast: maxEast + padEast,
    minNorth: minNorth - padNorth,
    maxNorth: maxNorth + padNorth,
  };
}

function collectPoints(rig: Rig, site: Site): Point[] {
  const points: Point[] = [];
  for (const id of rig.positionIds()) {
    const spot = rig.position(id);
    if (spot !== undefined) {
      points.push({ east: spot.east, north: spot.north });
    }
  }
  for (const line of [site.spectatorLine, ...site.boundaries]) {
    points.push(...line.points);
  }
  for (const house of site.houses) {
    points.push(house.at);
  }
  return points;
}

class Canvas {
  private readonly cells: string[][];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly bounds: Bounds,
  ) {
    this.cells = Array.from({ length: height }, () =>
      new Array<string>(width).fill(" "),
    );
  }

  private column(east: number): number {
    const span = this.bounds.maxEast - this.bounds.minEast || 1;
    return Math.round(((east - this.bounds.minEast) / span) * (this.width - 1));
  }

  private row(north: number): number {
    const span = this.bounds.maxNorth - this.bounds.minNorth || 1;
    // North is up, so the top row is the largest north value.
    return Math.round(
      ((this.bounds.maxNorth - north) / span) * (this.height - 1),
    );
  }

  put(point: Point, mark: string, overwrite = true): void {
    const x = this.column(point.east);
    const y = this.row(point.north);
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }
    const row = this.cells[y];
    if (row === undefined) {
      return;
    }
    if (!overwrite && row[x] !== " ") {
      return;
    }
    row[x] = mark;
  }

  line(from: Point, to: Point, mark: string): void {
    const steps = Math.max(
      Math.abs(this.column(to.east) - this.column(from.east)),
      Math.abs(this.row(to.north) - this.row(from.north)),
      1,
    );
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.put(
        {
          east: from.east + (to.east - from.east) * t,
          north: from.north + (to.north - from.north) * t,
        },
        mark,
        false,
      );
    }
  }

  ring(centre: Point, radius: number, mark: string): void {
    const steps = Math.max(24, Math.round(radius));
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      this.put(
        {
          east: centre.east + Math.cos(angle) * radius,
          north: centre.north + Math.sin(angle) * radius,
        },
        mark,
        false,
      );
    }
  }

  render(): string {
    return this.cells.map((row) => row.join("").trimEnd()).join("\n");
  }
}

function drawBoundary(canvas: Canvas, line: Boundary, mark: string): void {
  for (let i = 1; i < line.points.length; i += 1) {
    const from = line.points[i - 1];
    const to = line.points[i];
    if (from !== undefined && to !== undefined) {
      canvas.line(from, to, mark);
    }
  }
}

export function sitePlan(
  rig: Rig,
  site: Site,
  schedule?: Schedule | QuantisedSchedule,
  options: PlanOptions = {},
): string {
  const width = clamp(options.width ?? 72, 20, 200);
  const height = clamp(options.height ?? 24, 8, 100);
  const bounds = boundsOf(collectPoints(rig, site));
  const canvas = new Canvas(width, height, bounds);

  for (const line of site.boundaries) {
    drawBoundary(canvas, line, line.hard ? "#" : "-");
  }
  drawBoundary(canvas, site.spectatorLine, "=");

  if ((options.rings ?? false) && schedule !== undefined) {
    for (const id of rig.positionIds()) {
      const spot = rig.position(id);
      if (spot === undefined) {
        continue;
      }
      const here = schedule.events.filter((event) => event.position === id);
      let worst = 0;
      for (const event of here) {
        worst = Math.max(
          worst,
          raw(separationForEffect(event.effect, options.rule)),
        );
      }
      if (worst > 0) {
        canvas.ring({ east: spot.east, north: spot.north }, worst, ".");
      }
    }
  }

  // Houses go on before the positions, so a position standing on top of one
  // still shows as the position; the key carries both.
  for (const house of site.houses) {
    canvas.put(house.at, "H");
  }

  let discs = 0;
  if ((options.fallout ?? false) && schedule !== undefined) {
    for (const id of rig.positionIds()) {
      const spot = rig.position(id);
      if (spot === undefined) {
        continue;
      }
      let widest: ReturnType<typeof landingOf> | undefined;
      for (const event of schedule.events) {
        if (event.position !== id) {
          continue;
        }
        const landing = landingOf(spot, event.effect, options.wind);
        if (widest === undefined || raw(landing.radius) > raw(widest.radius)) {
          widest = landing;
        }
      }
      if (widest !== undefined) {
        canvas.ring(widest.centre, raw(widest.radius), "o");
        discs += 1;
      }
    }
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ids = rig.positionIds();
  ids.forEach((id, index) => {
    const spot = rig.position(id);
    if (spot !== undefined) {
      canvas.put(
        { east: spot.east, north: spot.north },
        letters[index % letters.length] ?? "*",
      );
    }
  });

  const key = ids.map(
    (id, index) => `${letters[index % letters.length] ?? "*"} ${id}`,
  );
  const houses = site.houses.map((house) => `H ${house.name}`);
  return [
    canvas.render(),
    "",
    `north is up, ${(bounds.maxEast - bounds.minEast).toFixed(0)}m across`,
    ...key,
    ...houses,
    "= audience line, # hard boundary, - soft boundary",
    ...(discs === 0
      ? []
      : [
          options.wind === undefined
            ? "o fallout disc in still air"
            : "o fallout disc where the wind puts it",
        ]),
  ].join("\n");
}

/** Positions a show actually fires from, for a plan that hides the spares. */
export function firingPositionsUsed(
  schedule: Schedule | QuantisedSchedule,
): string[] {
  return distinct(schedule.events, (event) => event.position);
}
