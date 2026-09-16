#!/usr/bin/env python3
"""Every edit the site-sheet solution makes to an existing source file, as
(file, old, new) triples, applied or reversed against one tree.

    ./edits.py apply   <tree>    # base -> solution
    ./edits.py reverse <tree>    # solution -> base
    ./edits.py check   <tree>    # report which edits are present

Each old string must occur exactly once, so a silent no-op is impossible.
"""

from __future__ import annotations

import sys
from pathlib import Path

EDITS: list[tuple[str, str, str]] = []


def edit(file: str, old: str, new: str) -> None:
    EDITS.append((file, old, new))


# --- src/safety/site.ts ------------------------------------------------------

edit(
    "src/safety/site.ts",
    """export interface Site {
  readonly name: string;
  /** The line the audience stands behind. */
  readonly spectatorLine: Boundary;
  /** Rivers, roads, hedges, buildings. */
  readonly boundaries: readonly Boundary[];
}
""",
    """/**
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
""",
)

edit(
    "src/safety/site.ts",
    """export function site(
  name: string,
  spectatorLine: Boundary,
  boundaries: readonly Boundary[] = [],
): Site {
  return { name, spectatorLine, boundaries };
}""",
    """export function site(
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
}""",
)

# --- src/safety/rules.ts -----------------------------------------------------

edit(
    "src/safety/rules.ts",
    """import type { Site } from "./site.js";
import { clearances, distanceToAudience, falloutClears } from "./site.js";
import type { Wind } from "./wind.js";
import { driftDistance, windVerdict } from "./wind.js";
import { envelopeOf, ceilingOf } from "../catalog/envelope.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { Metres } from "../core/units.js";
import { metres, raw } from "../core/units.js";
import type { Rig } from "../rig/rig.js";
""",
    """import { checkNoise, peakLevel } from "./noise.js";
import type { NoiseContext } from "./noise.js";
import type { House, Point, Site } from "./site.js";
import {
  clearances,
  distanceToAudience,
  houseBoundary,
  landingCrosses,
  positionPoint,
} from "./site.js";
import type { Wind } from "./wind.js";
import { driftedCentre, windVerdict } from "./wind.js";
import type { Effect } from "../catalog/effect.js";
import { envelopeOf, ceilingOf } from "../catalog/envelope.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { Metres } from "../core/units.js";
import { metres, raw } from "../core/units.js";
import type { FiringPosition, Rig } from "../rig/rig.js";
""",
)

edit(
    "src/safety/rules.ts",
    """ * Separation and airspace are errors. Wind and fallout margins are warnings
 * unless they are actually breached, because both depend on a forecast that
 * will have changed by the time the show fires.
 */""",
    """ * Separation and airspace are errors. Wind and fallout margins are warnings
 * unless they are actually breached, because both depend on a forecast that
 * will have changed by the time the show fires.
 *
 * Fallout is judged where it lands rather than where it is fired. The disc is
 * drawn round the point the wind carries the casing to, which is what the
 * wind model has been saying all along, and a line the casing was carried
 * over is crossed whether or not the disc happens to reach back to it.
 * Noise is judged at each house on the site against that house's own limit.
 */""",
)

edit(
    "src/safety/rules.ts",
    """export function checkFallout(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const seen = new Set<string>();
  for (const event of schedule.events) {
    const position = context.rig.position(event.position);
    if (position === undefined) {
      continue;
    }
    const envelope = envelopeOf(event.effect);
    const drift =
      context.wind === undefined
        ? metres(0)
        : driftDistance(envelope.centreHeight, context.wind);
    const radius = metres(raw(envelope.falloutRadius) + raw(drift));
    for (const crossed of falloutClears(position, context.site, radius)) {
      const key = `${event.position}|${crossed}|${event.effectId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      diagnostics.error({
        code: "PF4102",
        message: `fallout from ${event.effectId} at ${event.position} reaches the ${crossed}`,
        help: "this is a hard boundary, nothing may land past it",
      });
    }
  }
  return diagnostics;
}
""",
    """/** Where an effect's debris comes down, and how wide a disc it makes. */
export interface Landing {
  readonly centre: Point;
  readonly radius: Metres;
}

/**
 * The casing leaves the break with no upward speed and is carried downwind
 * the whole way down, so the disc is centred wherever the drift puts it and
 * keeps the effect's own fallout radius. In still air it sits on the mortar.
 */
export function landingOf(
  position: FiringPosition,
  effect: Effect,
  air?: Wind,
): Landing {
  const envelope = envelopeOf(effect);
  const here = positionPoint(position);
  return {
    centre:
      air === undefined ? here : driftedCentre(here, envelope.centreHeight, air),
    radius: envelope.falloutRadius,
  };
}

export function checkFallout(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const seen = new Set<string>();
  for (const event of schedule.events) {
    const position = context.rig.position(event.position);
    if (position === undefined) {
      continue;
    }
    const landing = landingOf(position, event.effect, context.wind);
    const crossed = landingCrosses(
      positionPoint(position),
      landing.centre,
      landing.radius,
      context.site,
    );
    for (const line of crossed) {
      const key = `${event.position}|${line}|${event.effectId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      diagnostics.error({
        code: "PF4102",
        message: `fallout from ${event.effectId} at ${event.position} reaches the ${line}`,
        help: "this is a hard boundary, nothing may land past it",
      });
    }
  }
  return diagnostics;
}

/** What one house hears, for a report. */
export interface HouseNoise {
  readonly house: House;
  /** The loudest instant of the show heard there, in decibels. */
  readonly peak: number;
}

function contextAt(house: House, rig: Rig): NoiseContext {
  return {
    rig,
    sensitive: houseBoundary(house),
    name: house.name,
    ...(house.limit === undefined ? {} : { limit: house.limit }),
  };
}

export function houseNoise(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): HouseNoise[] {
  return context.site.houses.map((house) => ({
    house,
    peak: peakLevel(schedule, contextAt(house, context.rig)),
  }));
}

/**
 * Every house on the site, each against its own limit. A house that has no
 * limit is still measured for the report, and never fails anything.
 */
export function checkHouses(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const house of context.site.houses) {
    diagnostics.addAll(
      checkNoise(schedule, contextAt(house, context.rig)).all(),
    );
  }
  return diagnostics;
}
""",
)

edit(
    "src/safety/rules.ts",
    """    .addAll(checkFallout(schedule, context).all());
  if (context.wind""",
    """    .addAll(checkFallout(schedule, context).all())
    .addAll(checkHouses(schedule, context).all());
  if (context.wind""",
)

# --- src/safety/noise.ts -----------------------------------------------------

edit(
    "src/safety/noise.ts",
    """  /** Peak level the licence allows, in decibels. */
  readonly limit?: number;
}""",
    """  /** Peak level the licence allows, in decibels. */
  readonly limit?: number;
  /** What to call the property in a finding, when the site names it. */
  readonly name?: string;
}

function whereOf(context: NoiseContext): string {
  return context.name === undefined ? "" : ` at ${context.name}`;
}""",
)
edit(
    "src/safety/noise.ts",
    """      message: `the show peaks at ${peak.toFixed(0)}dB against a ${limit}dB limit`,""",
    """      message: `the show peaks at ${peak.toFixed(0)}dB against a ${limit}dB limit${whereOf(context)}`,""",
)
edit(
    "src/safety/noise.ts",
    """      message: `the show peaks at ${peak.toFixed(0)}dB, within 3dB of the limit`,""",
    """      message: `the show peaks at ${peak.toFixed(0)}dB, within 3dB of the limit${whereOf(context)}`,""",
)
edit(
    "src/safety/noise.ts",
    """        message: `${finding.effectId} alone reads ${finding.level.toFixed(0)}dB from ${finding.position}`,""",
    """        message: `${finding.effectId} alone reads ${finding.level.toFixed(0)}dB from ${finding.position}${whereOf(context)}`,""",
)

# --- src/export/siteplan.ts --------------------------------------------------

edit(
    "src/export/siteplan.ts",
    """  for (const line of [site.spectatorLine, ...site.boundaries]) {
    points.push(...line.points);
  }
  return points;""",
    """  for (const line of [site.spectatorLine, ...site.boundaries]) {
    points.push(...line.points);
  }
  for (const house of site.houses) {
    points.push(house.at);
  }
  return points;""",
)
edit(
    "src/export/siteplan.ts",
    """  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ids = rig.positionIds();""",
    """  // Houses go on before the positions, so a position standing on top of one
  // still shows as the position; the key carries both.
  for (const house of site.houses) {
    canvas.put(house.at, "H");
  }

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ids = rig.positionIds();""",
)
edit(
    "src/export/siteplan.ts",
    """  const key = ids.map(
    (id, index) => `${letters[index % letters.length] ?? "*"} ${id}`,
  );
  return [
    canvas.render(),
    "",
    `north is up, ${(bounds.maxEast - bounds.minEast).toFixed(0)}m across`,
    ...key,
    "= audience line, # hard boundary, - soft boundary",
  ].join("\\n");""",
    """  const key = ids.map(
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
  ].join("\\n");""",
)

# --- src/export/permit.ts ----------------------------------------------------

edit(
    "src/export/permit.ts",
    """import { distanceToAudience } from "../safety/site.js";
import type { Site } from "../safety/site.js";""",
    """import { houseNoise } from "../safety/rules.js";
import { clearances, distanceToAudience } from "../safety/site.js";
import type { Site } from "../safety/site.js";""",
)
edit(
    "src/export/permit.ts",
    """export function permitDocument(""",
    """/**
 * What the site itself says: how close each position sits to the nearest
 * line nothing may land past, and what each house hears. An authority asks
 * both, and both come from the same sheet the safety checks ran against.
 */
export function permitSiteLines(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  site: Site,
): string[] {
  const lines: string[] = [];
  for (const id of rig.positionIds()) {
    const position = rig.position(id);
    if (position === undefined) {
      continue;
    }
    const nearest = clearances(position, site).find((line) => line.hard);
    lines.push(
      nearest === undefined
        ? `${id}: no hard boundary`
        : `${id}: ${raw(nearest.distance).toFixed(0)}m to the ${nearest.boundary}`,
    );
  }
  for (const heard of houseNoise(schedule, { site, rig })) {
    const limit =
      heard.house.limit === undefined
        ? "no limit"
        : `${heard.house.limit.toFixed(0)}dB allowed`;
    lines.push(
      `${heard.house.name}: peak ${heard.peak.toFixed(0)}dB, ${limit}`,
    );
  }
  return lines;
}

export function permitDocument(""",
)
edit(
    "src/export/permit.ts",
    """  const facts = permitFacts(schedule, rig, site, details, rule);
  return [
    `${details.showName} at ${details.siteName}`,
    "",
    permitSummary(facts),
    "",
    "shot list",""",
    """  const facts = permitFacts(schedule, rig, site, details, rule);
  const siteLines =
    site.houses.length === 0 && !site.boundaries.some((line) => line.hard)
      ? []
      : ["", "site", "", ...permitSiteLines(schedule, rig, site)];
  return [
    `${details.showName} at ${details.siteName}`,
    "",
    permitSummary(facts),
    ...siteLines,
    "",
    "shot list",""",
)

# --- src/cli/env.ts ----------------------------------------------------------

edit(
    "src/cli/env.ts",
    """import { parseRig } from "../rig/parse.js";
import type { RigSettings } from "../rig/parse.js";
import { Rig } from "../rig/rig.js";""",
    """import { parseRig } from "../rig/parse.js";
import type { RigSettings } from "../rig/parse.js";
import { Rig } from "../rig/rig.js";
import { parseSite } from "../safety/siteSheet.js";
import type { Site } from "../safety/site.js";""",
)
edit(
    "src/cli/env.ts",
    """export interface Workspace {
  readonly catalog: Catalog;
  readonly rig: Rig;
  readonly settings: RigSettings;
  readonly diagnostics: DiagnosticBag;
}""",
    """export interface Workspace {
  readonly catalog: Catalog;
  readonly rig: Rig;
  readonly settings: RigSettings;
  /** The surveyed site, when a sheet was named and read cleanly. */
  readonly site?: Site;
  readonly diagnostics: DiagnosticBag;
}""",
)
edit(
    "src/cli/env.ts",
    """export function loadWorkspace(
  env: CliEnv,
  paths: { readonly catalog?: string; readonly rig?: string },
): Workspace {
  const diagnostics = new DiagnosticBag();
  let catalog = new Catalog();
  let rig = new Rig();
  let settings: RigSettings | undefined;
""",
    """export function loadWorkspace(
  env: CliEnv,
  paths: {
    readonly catalog?: string;
    readonly rig?: string;
    readonly site?: string;
  },
): Workspace {
  const diagnostics = new DiagnosticBag();
  let catalog = new Catalog();
  let rig = new Rig();
  let settings: RigSettings | undefined;
  let site: Site | undefined;
""",
)
edit(
    "src/cli/env.ts",
    """  return {
    catalog,
    rig,
    settings: settings ?? fallbackSettings(),
    diagnostics,
  };
}""",
    """  // A sheet that will not read is no site at all: a command that needs one
  // says so, and a command that does not carries on with the errors printed.
  if (paths.site !== undefined) {
    const text = env.readFile(paths.site);
    if (text === undefined) {
      diagnostics.error({
        code: "PF5002",
        message: `cannot read the site sheet at ${paths.site}`,
      });
    } else {
      const parsed = parseSite(text, paths.site);
      diagnostics.addAll(parsed.diagnostics.all());
      if (!parsed.diagnostics.hasErrors()) {
        site = parsed.site;
      }
    }
  }

  return {
    catalog,
    rig,
    settings: settings ?? fallbackSettings(),
    ...(site === undefined ? {} : { site }),
    diagnostics,
  };
}""",
)

# --- src/cli/commands/common.ts ----------------------------------------------

edit(
    "src/cli/commands/common.ts",
    """import { point, site, straightLine } from "../../safety/site.js";
import type { Site } from "../../safety/site.js";""",
    """import { point, site, straightLine } from "../../safety/site.js";
import type { Site } from "../../safety/site.js";
import { parseSite } from "../../safety/siteSheet.js";""",
)
edit(
    "src/cli/commands/common.ts",
    """  { name: "ceiling", kind: "value", help: "airspace ceiling in metres" },
  {
    name: "audience",
    kind: "value",
    help: "metres from the origin to the line",
  },
  { name: "wind", kind: "value", help: "wind speed in metres per second" },
  { name: "wind-from", kind: "value", help: "wind bearing in degrees" },""",
    """  { name: "ceiling", kind: "value", help: "airspace ceiling in metres" },
  {
    name: "audience",
    kind: "value",
    help: "metres from the origin to the line",
  },
  { name: "site", kind: "value", help: "the site sheet" },
  { name: "wind", kind: "value", help: "wind speed in metres per second" },
  {
    name: "wind-from",
    kind: "value",
    help: "where the wind comes from, degrees clockwise from north",
  },""",
)
edit(
    "src/cli/commands/common.ts",
    """export function windFromArgs(args: ParsedArgs): Wind | undefined {
  const speed = numberOf(args, "wind");
  if (speed === undefined) {
    return undefined;
  }
  return wind(
    metresPerSecond(Math.max(0, speed)),
    numberOf(args, "wind-from") ?? 0,
  );
}""",
    """/**
 * A forecast names where the wind comes from, and the model wants where it
 * goes, so the bearing turns round here and nowhere else. A wind from the
 * south carries fallout north.
 */
export function windFromArgs(args: ParsedArgs): Wind | undefined {
  const speed = numberOf(args, "wind");
  if (speed === undefined) {
    return undefined;
  }
  const from = numberOf(args, "wind-from") ?? 0;
  return wind(metresPerSecond(Math.max(0, speed)), from + 180);
}

/**
 * The site a command works against: the sheet when one was read, else the
 * straight line the audience distance describes. Both at once is a mistake
 * rather than a merge, since the sheet already says where the audience is.
 */
export function siteFor(
  args: ParsedArgs,
  workspace: Workspace,
): Site | undefined {
  return workspace.site ?? siteFromArgs(args);
}

/** The name a document calls the site, unless the command was told one. */
export function siteNameFor(
  args: ParsedArgs,
  where: Site | undefined,
): string {
  return valueOf(args, "site-name") ?? where?.name ?? "unnamed site";
}

/** Read a sheet on its own, for a command that has no show to compile. */
export function readSiteSheet(
  path: string,
  env: CliEnv,
): Site | undefined {
  const text = env.readFile(path);
  if (text === undefined) {
    env.err(`cannot read the site sheet at ${path}`);
    return undefined;
  }
  const parsed = parseSite(text, path);
  if (parsed.diagnostics.size > 0) {
    env.err(formatBag(parsed.diagnostics));
  }
  return parsed.diagnostics.hasErrors() ? undefined : parsed.site;
}""",
)
edit(
    "src/cli/commands/common.ts",
    """  const source = env.readFile(path);
  if (source === undefined) {
    env.err(`cannot read the script at ${path}`);
    return undefined;
  }
  const workspace = loadWorkspace(env, {
    ...(valueOf(args, "catalog") === undefined
      ? {}
      : { catalog: valueOf(args, "catalog") as string }),
    ...(valueOf(args, "rig") === undefined
      ? {}
      : { rig: valueOf(args, "rig") as string }),
  });
""",
    """  const source = env.readFile(path);
  if (source === undefined) {
    env.err(`cannot read the script at ${path}`);
    return undefined;
  }
  if (
    valueOf(args, "site") !== undefined &&
    valueOf(args, "audience") !== undefined
  ) {
    env.err("--site and --audience both say where the audience is, give one");
    return undefined;
  }
  const workspace = loadWorkspace(env, {
    ...(valueOf(args, "catalog") === undefined
      ? {}
      : { catalog: valueOf(args, "catalog") as string }),
    ...(valueOf(args, "rig") === undefined
      ? {}
      : { rig: valueOf(args, "rig") as string }),
    ...(valueOf(args, "site") === undefined
      ? {}
      : { site: valueOf(args, "site") as string }),
  });
""",
)
edit(
    "src/cli/commands/common.ts",
    """  const where = siteFromArgs(args);
  const air = windFromArgs(args);""",
    """  const where = siteFor(args, workspace);
  const air = windFromArgs(args);""",
)

# --- src/cli/commands/plan.ts ------------------------------------------------

edit(
    "src/cli/commands/plan.ts",
    'import { SHOW_FLAGS, outcomeCode, runShow, siteFromArgs } from "./common.js";',
    'import { SHOW_FLAGS, outcomeCode, runShow, siteFor } from "./common.js";',
)
edit(
    "src/cli/commands/plan.ts",
    """  usage: "plan <script> --audience <metres> [options]",""",
    """  usage: "plan <script> --audience <metres> | --site <sheet> [options]",""",
)
edit(
    "src/cli/commands/plan.ts",
    """  run(args, env) {
    const where = siteFromArgs(args);
    if (where === undefined) {
      env.err("plan needs --audience, the metres from the origin to the line");
      return EXIT_BAD_USAGE;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const width""",
    """  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const where = siteFor(args, outcome.inputs.workspace);
    if (where === undefined) {
      env.err(
        "plan needs --audience, the metres from the origin to the line, or --site, the sheet",
      );
      return EXIT_BAD_USAGE;
    }
    const width""",
)

# --- src/cli/commands/permit.ts ----------------------------------------------

edit(
    "src/cli/commands/permit.ts",
    """  runShow,
  siteFromArgs,
} from "./common.js";""",
    """  runShow,
  siteFor,
  siteNameFor,
} from "./common.js";""",
)
edit(
    "src/cli/commands/permit.ts",
    """  usage: "permit <script> --audience <metres> [options]",""",
    """  usage: "permit <script> --audience <metres> | --site <sheet> [options]",""",
)
edit(
    "src/cli/commands/permit.ts",
    """  run(args, env) {
    const where = siteFromArgs(args);
    if (where === undefined) {
      env.err(
        "permit needs --audience, the metres from the origin to the line",
      );
      return EXIT_BAD_USAGE;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const details: PermitDetails = {
      showName: args.values.get("show-name") ?? outcome.inputs.name,
      siteName: args.values.get("site-name") ?? "unnamed site",""",
    """  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const where = siteFor(args, outcome.inputs.workspace);
    if (where === undefined) {
      env.err(
        "permit needs --audience, the metres from the origin to the line, or --site, the sheet",
      );
      return EXIT_BAD_USAGE;
    }
    const details: PermitDetails = {
      showName: args.values.get("show-name") ?? outcome.inputs.name,
      siteName: siteNameFor(args, where),""",
)

# --- src/cli/commands/pack.ts ------------------------------------------------

edit(
    "src/cli/commands/pack.ts",
    """  runShow,
  siteFromArgs,
} from "./common.js";""",
    """  runShow,
  siteFor,
  siteNameFor,
} from "./common.js";""",
)
edit(
    "src/cli/commands/pack.ts",
    """    const site = siteFromArgs(args);
    const permit: PermitDetails | undefined =
      site === undefined
        ? undefined
        : {
            showName: args.values.get("show-name") ?? outcome.inputs.name,
            siteName: args.values.get("site-name") ?? "unnamed site",""",
    """    const site = siteFor(args, outcome.inputs.workspace);
    const permit: PermitDetails | undefined =
      site === undefined
        ? undefined
        : {
            showName: args.values.get("show-name") ?? outcome.inputs.name,
            siteName: siteNameFor(args, site),""",
)

# --- src/cli/commands/crowd.ts -----------------------------------------------

edit(
    "src/cli/commands/crowd.ts",
    """import { requireNumber } from "../args.js";""",
    """import { readSiteSheet } from "./common.js";
import { requireNumber } from "../args.js";""",
)
edit(
    "src/cli/commands/crowd.ts",
    """  capacityFor,
  checkCrowd,
  depthNeeded,
  describeCrowd,
} from "../../safety/crowd.js";""",
    """  capacityFor,
  checkCrowd,
  depthNeeded,
  describeCrowd,
  frontageOf,
} from "../../safety/crowd.js";""",
)
edit(
    "src/cli/commands/crowd.ts",
    """  usage: "crowd --frontage <m> --depth <m> --expected <people>",
  flags: [
    { name: "frontage", kind: "value", help: "metres along the audience line" },""",
    """  usage: "crowd --frontage <m> | --site <sheet> --depth <m> --expected <people>",
  flags: [
    { name: "frontage", kind: "value", help: "metres along the audience line" },
    {
      name: "site",
      kind: "value",
      help: "a site sheet, whose audience line gives the frontage",
    },""",
)
edit(
    "src/cli/commands/crowd.ts",
    """  run(args, env) {
    const frontage = requireNumber(args, "frontage", { min: 0 });
    if (!frontage.ok) {
      env.err(frontage.reason);
      return EXIT_BAD_USAGE;
    }""",
    """  run(args, env) {
    const frontage = frontageFromArgs(args, env);
    if (!frontage.ok) {
      env.err(frontage.reason);
      return EXIT_BAD_USAGE;
    }""",
)
edit(
    "src/cli/commands/crowd.ts",
    """    const diagnostics = checkCrowd(plan);
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};
""",
    """    const diagnostics = checkCrowd(plan);
    if (diagnostics.size > 0) {
      env.err(formatBag(diagnostics));
    }
    return diagnostics.hasErrors() ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};

/**
 * The frontage is either typed in or read off a surveyed audience line. A
 * sheet and a figure together is a contradiction waiting to happen, so it is
 * refused rather than resolved.
 */
function frontageFromArgs(
  args: Parameters<typeof requireNumber>[0],
  env: Parameters<Command["run"]>[1],
): { ok: true; value: number } | { ok: false; reason: string } {
  const sheet = args.values.get("site");
  if (sheet === undefined) {
    return requireNumber(args, "frontage", { min: 0 });
  }
  if (args.values.get("frontage") !== undefined) {
    return {
      ok: false,
      reason: "--site and --frontage both give the frontage, give one",
    };
  }
  const where = readSiteSheet(sheet, env);
  if (where === undefined) {
    return { ok: false, reason: `nothing usable was read from ${sheet}` };
  }
  return { ok: true, value: frontageOf(where.spectatorLine) };
}
""",
)

# --- src/core/codes.ts -------------------------------------------------------

edit(
    "src/core/codes.ts",
    """  [
    "PF1500",""",
    """  [
    "PF1700",
    "a site sheet has no audience line, and without one there is nothing to measure a separation distance to",
  ],
  [
    "PF1500",""",
)
edit(
    "src/core/codes.ts",
    """  [
    "PF4300",""",
    """  [
    "PF4200",
    "the loudest instant of the show is over the level the licence allows at a house on the site, which is what loses the licence for next year",
  ],
  [
    "PF4300",""",
)

# --- src/index.ts ------------------------------------------------------------

edit(
    "src/index.ts",
    """export * from "./safety/site.js";
export * from "./safety/wind.js";""",
    """export * from "./safety/site.js";
export * from "./safety/siteSheet.js";
export * from "./safety/wind.js";""",
)


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("apply", "reverse", "check"):
        print(__doc__)
        return 2
    mode, tree = sys.argv[1], Path(sys.argv[2])
    failed = 0
    for file, old, new in EDITS:
        path = tree / file
        text = path.read_text()
        if mode == "check":
            state = "applied" if new in text else ("base" if old in text else "NEITHER")
            print(f"{state:8} {file}")
            continue
        src, dst = (old, new) if mode == "apply" else (new, old)
        count = text.count(src)
        if count != 1:
            print(f"FAILED {file}: expected 1 match, found {count}")
            failed += 1
            continue
        path.write_text(text.replace(src, dst))
    print(f"{mode}: {len(EDITS) - failed} of {len(EDITS)} edits, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
