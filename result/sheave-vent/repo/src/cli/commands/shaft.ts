/**
 * `sheave shaft` — what will and will not go down the hole.
 *
 * A winding shaft has to hold two conveyances passing each other at
 * thirty miles an hour with a hand's breadth between them, the guides
 * that keep them apart, the ventilation air that has to get past both,
 * and the pipes down the side. Every one of those wants room and the
 * shaft was sunk once.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  BETWEEN_CONVEYANCES,
  BRISK_AIR,
  TO_GUIDES,
  TO_LINING,
  airSpeed,
  area,
  comfortable,
  deepest,
  describeShaft,
  excavated,
  freeArea,
  freeShare,
  insets,
  liningVolume,
  overwindRoom,
  ropeLength,
  shaft,
  stoppableFrom,
  sumpEnough,
  sumpFor,
  widestConveyance,
  widthWanted,
  willFit,
} from "../../shaft/shaft.ts";
import { heading, line, metres, places, share, speed, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "depth", "conveyances", "sump", "headgear", "width", "across", "air", "full", "insets", "sweep"];

/** Run it. */
export function shaftCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = shaft(
    "the shaft",
    option(args, "diameter") === undefined ? 7.3 : quantity(args, "diameter"),
    option(args, "depth") === undefined ? 942 : quantity(args, "depth"),
    number(args, "conveyances", 2),
    option(args, "sump") === undefined ? 15 : quantity(args, "sump"),
    option(args, "headgear") === undefined ? 42 : quantity(args, "headgear"),
  );
  const width = option(args, "width") === undefined ? 2.6 : quantity(args, "width");
  const across = option(args, "across") === undefined ? 1.5 : quantity(args, "across");
  const air = number(args, "air", 180);
  const full = option(args, "full") === undefined ? 15 : quantity(args, "full");

  const rows: Array<readonly [string, string]> = [
    ["diameter inside the lining", metres(one.diameter, 2)],
    ["cross-section", `${places(area(one), 1)} m²`],
    ["depth to the lowest inset", metres(one.depth)],
    ["rope a wind pays out", metres(ropeLength(one))],
    ["conveyances", places(one.conveyances, 0)],
    ["width they want across the shaft", metres(widthWanted(width, one.conveyances), 2)],
    ["which goes down it", verdict(willFit(one, width))],
    ["the widest it takes", metres(widestConveyance(one), 2)],
    ["free area for the air", `${places(freeArea(one, width, across), 1)} m²`],
    ["which is, of the whole", share(freeShare(one, width, across))],
    ["air speed at that quantity", speed(airSpeed(one, air, width, across))],
    ["comfortable to ride in", verdict(comfortable(one, air, width, across))],
    ["room above the bank", metres(overwindRoom(one), 1)],
    ["which arrests", speed(stoppableFrom(one))],
    ["sump", metres(one.sump, 1)],
    ["which an underwind at full speed wants", metres(sumpFor(full), 1)],
    ["deep enough", verdict(sumpEnough(one, full))],
  ];

  const out: string[] = [
    ...heading(describeShaft(one)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    line("the lining took", `${places(liningVolume(one), 0)} m³`),
    line("and the ground taken out", `${places(excavated(one), 0)} m³`),
  ];

  const at = option(args, "insets");
  if (at !== undefined) {
    const found = insets(one, at.split(",").map((each) => Number(each)));
    out.push(
      "",
      ...heading("the insets"),
      ...table(
        [right("inset"), right("wind"), right("rope")],
        found.map((each) => [metres(each), metres(each), metres(each + one.headgear)]),
      ),
      "",
      line("the winder must be sized on", metres(deepest(one, found))),
    );
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what each shaft diameter takes"),
      ...table(
        [right("shaft"), right("widest conveyance"), right("free area"), right("free share")],
        [4.9, 5.5, 6.1, 6.7, 7.3, 7.9].map((each) => {
          const trial = shaft("trial", each, one.depth, one.conveyances, one.sump, one.headgear);
          const widest = widestConveyance(trial);
          return [
            metres(each, 1),
            metres(widest, 2),
            `${places(freeArea(trial, widest, across), 1)} m²`,
            share(freeShare(trial, widest, across)),
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [
      line("between two passing conveyances", metres(BETWEEN_CONVEYANCES, 2)),
      line("from a conveyance to the lining", metres(TO_LINING, 2)),
      line("and to its own guides", metres(TO_GUIDES, 2)),
      line("air is brisk above", speed(BRISK_AIR)),
    ],
    wrapped(
      "A winding shaft is also a ventilation shaft at most collieries, and the two duties are in " +
        "direct competition: every square metre of conveyance is a square metre the air has to go " +
        "round. A colliery that puts bigger cages down an existing shaft finds out about it at " +
        "the fan.",
    ),
  );
}
