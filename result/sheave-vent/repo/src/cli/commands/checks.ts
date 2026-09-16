/**
 * `sheave checks` — the figures an installation is signed off against.
 *
 * Every band is reported whether it passes or not, so that an
 * installation which passes everything by a hair reads differently from
 * one which passes everything comfortably. The check with the least
 * room in it is the one that decides what the installation can be
 * pushed to, and it is rarely the one anybody was worried about.
 */

import { readFileSync } from "node:fs";
import type { Args } from "../args.ts";
import { flag, onlyKnown, word } from "../args.ts";
import { parseWinder } from "../../winder/parse.ts";
import { bands, checks, describeCheck, failed, meetsDesign, ratings, room, tightest } from "../../design/checks.ts";
import { heading, line, many, places, power, seconds, verdict, wrapped } from "../../report/format.ts";
import { barOf, blocks, centre, left, right, table } from "../../report/table.ts";

const KNOWN = ["failed", "bars"];

/** Run it. */
export function checksCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = parseWinder(readFileSync(word(args, 0, "a winder file"), "utf8"));
  const want = bands();
  const all = checks(one, want);
  const shown = flag(args, "failed") ? failed(all) : all;

  const band = (low: number | undefined, high: number | undefined): string => {
    if (low !== undefined && high !== undefined) return `${places(low, 2)} to ${places(high, 2)}`;
    if (high !== undefined) return `at most ${places(high, 2)}`;
    if (low !== undefined) return `at least ${places(low, 2)}`;
    return "—";
  };

  const found = ratings(one);
  const out: string[] = [
    ...heading(`${one.name}: ${power(found.peak)} peak, ${power(found.motor)} of motor, ${seconds(found.cycle)} a cycle`),
    ...table(
      [left("check"), right("found"), right("band"), centre("met"), flag(args, "bars") ? left("room") : right("room")],
      shown.map((each) => [
        each.name,
        places(each.found, 3),
        band(each.low, each.high),
        verdict(each.met),
        flag(args, "bars") ? barOf(room(each), 16) : places(room(each), 3),
      ]),
    ),
  ];

  const least = tightest(one, want);
  return blocks(
    out,
    [
      "",
      `${many(failed(all).length, "check")} missed of ${all.length}`,
      line("meets the design", verdict(meetsDesign(one, want))),
      `the tightest is ${least.name} at ${places(least.found, 3)} — ${least.says}`,
    ],
    wrapped(
      "Room is how far a figure is from the near edge of its band, as a share of the band. Zero " +
        "is exactly on the limit and one is as far from it as the band allows. It is what turns a " +
        "page of passes into a ranking, and the ranking is the useful part.",
    ),
  );
}
