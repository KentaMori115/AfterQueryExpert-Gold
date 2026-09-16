#!/usr/bin/env python3
"""Second batch of solution edits (applied on top of edits.py): landing discs
on the plan, sheet validation and writing, the largest quiet bore on the
permit, and `distance --site`. Same runner, same rules: every old string
must match exactly once.

    ./edits2.py apply|reverse|check <tree>
"""

from __future__ import annotations

import sys
from pathlib import Path

EDITS: list[tuple[str, str, str]] = []


def edit(file: str, old: str, new: str) -> None:
    EDITS.append((file, old, new))


# --- src/export/siteplan.ts: landing discs under the wind ---------------------

edit(
    "src/export/siteplan.ts",
    """import type { Boundary, Point, Site } from "../safety/site.js";
import { separationForEffect } from "../safety/distance.js";
import type { DistanceRule } from "../safety/distance.js";""",
    """import type { Boundary, Point, Site } from "../safety/site.js";
import { separationForEffect } from "../safety/distance.js";
import type { DistanceRule } from "../safety/distance.js";
import { landingOf } from "../safety/rules.js";
import type { Wind } from "../safety/wind.js";""",
)
edit(
    "src/export/siteplan.ts",
    """  /** Draw a ring at each position showing its separation distance. */
  readonly rings?: boolean;
  readonly rule?: DistanceRule;
}""",
    """  /** Draw a ring at each position showing its separation distance. */
  readonly rings?: boolean;
  readonly rule?: DistanceRule;
  /**
   * Draw where each position's widest fallout disc actually lands. Under a
   * wind the disc sits downwind of the letter, which is the picture a crew
   * clearing the field needs and the one a centred ring gets wrong.
   */
  readonly fallout?: boolean;
  readonly wind?: Wind;
}""",
)
edit(
    "src/export/siteplan.ts",
    """  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ids = rig.positionIds();
  ids.forEach((id, index) => {""",
    """  let discs = 0;
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
  ids.forEach((id, index) => {""",
)
edit(
    "src/export/siteplan.ts",
    """    ...key,
    ...houses,
    "= audience line, # hard boundary, - soft boundary",
  ].join("\\n");""",
    """    ...key,
    ...houses,
    "= audience line, # hard boundary, - soft boundary",
    ...(discs === 0
      ? []
      : [
          options.wind === undefined
            ? "o fallout disc in still air"
            : "o fallout disc where the wind puts it",
        ]),
  ].join("\\n");""",
)

# --- src/cli/commands/plan.ts: the flag ---------------------------------------

edit(
    "src/cli/commands/plan.ts",
    'import { SHOW_FLAGS, outcomeCode, runShow, siteFor } from "./common.js";',
    """import {
  SHOW_FLAGS,
  outcomeCode,
  runShow,
  siteFor,
  windFromArgs,
} from "./common.js";""",
)
edit(
    "src/cli/commands/plan.ts",
    """    { name: "rings", kind: "switch", help: "draw the separation distances" },
  ],""",
    """    { name: "rings", kind: "switch", help: "draw the separation distances" },
    {
      name: "fallout",
      kind: "switch",
      help: "draw where the fallout lands, downwind if --wind is given",
    },
  ],""",
)
edit(
    "src/cli/commands/plan.ts",
    """        rings: args.switches.has("rings"),
        ...(args.values.get("rule") === undefined""",
    """        rings: args.switches.has("rings"),
        fallout: args.switches.has("fallout"),
        ...(windFromArgs(args) === undefined
          ? {}
          : { wind: windFromArgs(args) as ReturnType<typeof windFromArgs> }),
        ...(args.values.get("rule") === undefined""",
)

# --- src/safety/siteSheet.ts: writing a sheet back, and checking one ----------

edit(
    "src/safety/siteSheet.ts",
    """/** The statements a sheet may hold, for a help screen or a completion. */""",
    """/** One coordinate pair the way a sheet writes it, whole metres kept whole. */
function pair(at: Point): string {
  const number = (value: number): string =>
    Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${number(at.east)} ${number(at.north)}`;
}

/**
 * Write a site back out as a sheet. A site built from an audience distance
 * on the command line becomes a file the crew can then survey the rest of
 * onto, and a sheet read and written again comes back the same.
 */
export function writeSite(where: Site): string {
  const lines = [`site ${where.name}`];
  lines.push(
    `audience ${where.spectatorLine.points.map(pair).join(" ")}`,
  );
  for (const line of where.boundaries) {
    const kind = line.hard ? "hard" : "soft";
    lines.push(`${kind} ${line.name} ${line.points.map(pair).join(" ")}`);
  }
  for (const property of where.houses) {
    const limit =
      property.limit === undefined ? "" : ` limit ${property.limit}`;
    lines.push(`house ${property.name} at ${pair(property.at)}${limit}`);
  }
  return lines.join("\\n") + "\\n";
}

/**
 * The things a sheet can get wrong that still parse. None of them stops a
 * show compiling, all of them mean somebody typed a coordinate with the sign
 * wrong or measured from a different corner, and the plan is the place they
 * would otherwise be noticed, the afternoon of the show.
 */
export function checkSite(where: Site, rig: Rig): DiagnosticBag {
  const diagnostics = new DiagnosticBag();

  const names = new Map<string, number>();
  for (const named of [...where.boundaries, ...where.houses]) {
    names.set(named.name, (names.get(named.name) ?? 0) + 1);
  }
  for (const [name, count] of names) {
    if (count > 1) {
      diagnostics.warning({
        code: "PF1708",
        message: `${name} is used ${count} times on the sheet`,
        help: "a finding names the line or the house, so give each its own name",
      });
    }
  }

  for (const line of hardBoundaries(where)) {
    if (
      where.spectatorLine.points.some((_, i, points) => {
        const a = points[i - 1];
        const b = points[i];
        return a !== undefined && b !== undefined && flightCrosses(a, b, line);
      })
    ) {
      diagnostics.warning({
        code: "PF1709",
        message: `the audience line crosses the ${line.name}`,
        help: "the audience cannot stand on the far side of a hard boundary",
      });
    }
  }

  for (const id of rig.positionIds()) {
    const position = rig.position(id);
    if (position === undefined) {
      continue;
    }
    const here = positionPoint(position);
    const toAudience = raw(distanceToBoundary(here, where.spectatorLine));
    for (const property of where.houses) {
      const toHouse = Math.hypot(
        property.at.east - here.east,
        property.at.north - here.north,
      );
      if (toHouse < toAudience) {
        diagnostics.warning({
          code: "PF1710",
          message: `${property.name} is ${toHouse.toFixed(0)}m from ${id}, nearer than the audience`,
          help: "check the house's coordinates, or the audience line's",
        });
      }
    }
  }
  return diagnostics;
}

/** The statements a sheet may hold, for a help screen or a completion. */""",
)
edit(
    "src/safety/siteSheet.ts",
    """import type { Boundary, House, Point, Site } from "./site.js";
import { boundary, house, point, site } from "./site.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { SourceFile, span } from "../core/span.js";""",
    """import type { Boundary, House, Point, Site } from "./site.js";
import {
  boundary,
  distanceToBoundary,
  flightCrosses,
  hardBoundaries,
  house,
  point,
  positionPoint,
  site,
} from "./site.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { SourceFile, span } from "../core/span.js";
import { raw } from "../core/units.js";
import type { Rig } from "../rig/rig.js";""",
)

# --- src/cli/env.ts: the sheet's warnings ride with the workspace -------------

edit(
    "src/cli/env.ts",
    """import { parseSite } from "../safety/siteSheet.js";""",
    """import { checkSite, parseSite } from "../safety/siteSheet.js";""",
)
edit(
    "src/cli/env.ts",
    """      const parsed = parseSite(text, paths.site);
      diagnostics.addAll(parsed.diagnostics.all());
      if (!parsed.diagnostics.hasErrors()) {
        site = parsed.site;
      }""",
    """      const parsed = parseSite(text, paths.site);
      diagnostics.addAll(parsed.diagnostics.all());
      if (!parsed.diagnostics.hasErrors()) {
        site = parsed.site;
        diagnostics.addAll(checkSite(site, rig).all());
      }""",
)

# --- src/export/permit.ts: the largest quiet bore per house -------------------

edit(
    "src/export/permit.ts",
    """import { houseNoise } from "../safety/rules.js";""",
    """import { standardCalibres } from "../catalog/calibre.js";
import { largestQuietCalibre } from "../safety/noise.js";
import { houseNoise } from "../safety/rules.js";
import { distanceToBoundary, houseBoundary } from "../safety/site.js";""",
)
edit(
    "src/export/permit.ts",
    """  for (const heard of houseNoise(schedule, { site, rig })) {
    const limit =
      heard.house.limit === undefined
        ? "no limit"
        : `${heard.house.limit.toFixed(0)}dB allowed`;
    lines.push(
      `${heard.house.name}: peak ${heard.peak.toFixed(0)}dB, ${limit}`,
    );
  }
  return lines;
}""",
    """  for (const heard of houseNoise(schedule, { site, rig })) {
    const limit =
      heard.house.limit === undefined
        ? "no limit"
        : `${heard.house.limit.toFixed(0)}dB allowed`;
    lines.push(
      `${heard.house.name}: peak ${heard.peak.toFixed(0)}dB, ${limit}`,
    );
    const quiet = quietestBore(heard.house, rig);
    if (quiet !== undefined) {
      lines.push(`  ${quiet}`);
    }
  }
  return lines;
}

/**
 * The largest single shell that stays inside a house's limit from the
 * nearest position, which is the figure a designer redesigning a loud show
 * wants before anything else.
 */
function quietestBore(property: House, rig: Rig): string | undefined {
  if (property.limit === undefined) {
    return undefined;
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (const id of rig.positionIds()) {
    const position = rig.position(id);
    if (position === undefined) {
      continue;
    }
    nearest = Math.min(
      nearest,
      raw(
        distanceToBoundary(
          { east: position.east, north: position.north },
          houseBoundary(property),
        ),
      ),
    );
  }
  if (!Number.isFinite(nearest)) {
    return undefined;
  }
  const largest = largestQuietCalibre(
    property.limit,
    metres(nearest),
    standardCalibres(),
  );
  return largest === undefined
    ? `nothing on the standard list stays under ${property.limit.toFixed(0)}dB from ${nearest.toFixed(0)}m`
    : `a single ${raw(largest.size).toFixed(0)}mm shell stays under ${property.limit.toFixed(0)}dB from ${nearest.toFixed(0)}m`;
}""",
)
edit(
    "src/export/permit.ts",
    """import type { Site } from "../safety/site.js";""",
    """import type { House, Site } from "../safety/site.js";""",
)

# --- src/cli/commands/distance.ts: what a surveyed field takes ----------------

edit(
    "src/cli/commands/distance.ts",
    """import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";""",
    """import { readSiteSheet } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";
import { loadWorkspace } from "../env.js";
import { distanceToAudience } from "../../safety/site.js";""",
)
edit(
    "src/cli/commands/distance.ts",
    """    {
      name: "available",
      kind: "value",
      help: "metres of room, to ask what fits",
    },
    { name: "feet", kind: "switch", help: "print distances in feet as well" },
  ],
  run(args, env) {
    const rule = (args.values.get("rule") ?? "nfpa-1123") as DistanceRule;
""",
    """    {
      name: "available",
      kind: "value",
      help: "metres of room, to ask what fits",
    },
    {
      name: "site",
      kind: "value",
      help: "a site sheet, to ask what its tightest position takes",
    },
    { name: "rig", kind: "value", help: "the rig sheet, with --site" },
    { name: "feet", kind: "switch", help: "print distances in feet as well" },
  ],
  run(args, env) {
    const rule = (args.values.get("rule") ?? "nfpa-1123") as DistanceRule;

    // A surveyed site answers the room question itself: the tightest position
    // against the audience line is the number the whole show is designed to.
    const sheet = args.values.get("site");
    if (sheet !== undefined) {
      const rigPath = args.values.get("rig");
      if (rigPath === undefined) {
        env.err("distance --site needs --rig, the positions to measure from");
        return EXIT_BAD_USAGE;
      }
      const where = readSiteSheet(sheet, env);
      if (where === undefined) {
        return EXIT_BAD_USAGE;
      }
      const workspace = loadWorkspace(env, { rig: rigPath });
      if (workspace.diagnostics.hasErrors()) {
        env.err(`cannot use the rig at ${rigPath}`);
        return EXIT_BAD_USAGE;
      }
      let room = Number.POSITIVE_INFINITY;
      let tightest = "";
      for (const id of workspace.rig.positionIds()) {
        const position = workspace.rig.position(id);
        if (position === undefined) {
          continue;
        }
        const clear = raw(distanceToAudience(position, where));
        if (clear < room) {
          room = clear;
          tightest = id;
        }
      }
      if (!Number.isFinite(room)) {
        env.err("the rig has no positions to measure from");
        return EXIT_BAD_USAGE;
      }
      const largest = largestCalibreFor(metres(room), rule);
      env.out(
        largest === 0
          ? `${tightest} has ${room.toFixed(0)}m to the audience, not enough for anything under ${rule}`
          : `${tightest} has ${room.toFixed(0)}m to the audience and takes up to ${largest}mm under ${rule}`,
      );
      return EXIT_OK;
    }
""",
)

# --- src/core/codes.ts -------------------------------------------------------

edit(
    "src/core/codes.ts",
    """  [
    "PF1500",""",
    """  [
    "PF1710",
    "a house on the site sheet is nearer to a firing position than the audience is, which is nearly always a coordinate typed against the wrong origin",
  ],
  [
    "PF1500",""",
)

# --- README ------------------------------------------------------------------

edit(
    "README.md",
    """`plan` draws each house as `H` and lists it in the key, `permit` and `pack`
take the site's name from the sheet and quote the nearest hard boundary and
the peak at each house, and `crowd --site` reads the frontage off the
audience line instead of `--frontage`.""",
    """`plan` draws each house as `H` and lists it in the key, and with `--fallout`
draws each position's widest fallout disc where it lands, downwind when a
wind is given. `permit` and `pack` take the site's name from the sheet and
quote the nearest hard boundary, the peak at each house and the largest
single shell that would stay inside its limit. `crowd --site` reads the
frontage off the audience line instead of `--frontage`, and
`distance --site --rig` says what the tightest position on a surveyed site
can take.

Reading a sheet also checks it for the mistakes that parse cleanly: a name
used twice, an audience line that crosses a hard boundary, and a house nearer
to a position than the audience is. Each is a warning, because each one is
usually a coordinate measured from the wrong corner.""",
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
