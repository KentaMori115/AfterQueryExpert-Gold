/**
 * `sheave capel` — the termination, and the calendar it puts on a rope.
 *
 * A winding rope does not part in the middle. It parts at the capel,
 * because that is where the rope is bent, worked and corroded all at
 * once. So the capel is remade every six months whether it needs it or
 * not, and a length is cut off the end each time — which is why a
 * winding rope has to be ordered longer than the shaft and why it is
 * eventually too short to reach the bottom while being perfectly sound
 * everywhere else.
 */

import type { Args } from "../args.ts";
import { number, onlyKnown, option, quantity } from "../args.ts";
import { constructionNamed, rope } from "../../rope/construction.ts";
import {
  CAPPINGS,
  CUT_OFF,
  RECAP_MONTHS,
  busyLength,
  busyShare,
  cappingHours,
  cappingNamed,
  capped,
  describeCapping,
  goodForWinding,
  heldBy,
  keeps,
  orderExtra,
  orderLength,
  recappings,
  servesFor,
  shiftFor,
  whiteMetal,
} from "../../rope/capping.ts";
import { force, heading, kilograms, line, metres, places, share, spaced, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "construction", "grade", "capping", "depth", "headgear", "dead", "months", "have"];

/** Run it. */
export function capelCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const made = constructionNamed(option(args, "construction") ?? "6x36");
  const diameter = option(args, "diameter") === undefined ? 52 : quantity(args, "diameter") * 1000;
  const one = rope(Math.round(diameter * 1000) / 1000, made, number(args, "grade", 1960));
  const how = cappingNamed(option(args, "capping") ?? "white metal");
  const depth = number(args, "depth", 942);
  const headgear = number(args, "headgear", 42);
  const dead = number(args, "dead", 40);
  const months = number(args, "months", 24);
  const have = number(args, "have", orderLength(depth, headgear, dead, months));

  const out: string[] = [
    ...heading(describeCapping(one, how)),
    ...table(
      [left(""), right("")],
      [
        ["it holds", force(heldBy(one, how))],
        ["of the rope's own", share(keeps(how))],
        ["good for a winding rope", verdict(goodForWinding(how))],
        ["white metal it takes", kilograms(whiteMetal(one), 2)],
        ["hours to make", places(cappingHours(one), 1)],
      ],
    ),
    "",
    ...heading("the calendar the capel puts on the rope"),
    ...table(
      [left(""), right("")],
      [
        ["the wind", metres(depth)],
        ["over the headgear", metres(headgear)],
        ["dead turns on the drum", metres(dead)],
        ["cut off at each recapping", metres(CUT_OFF, 1)],
        ["recappings in that life", places(recappings(months), 0)],
        ["so the spare end wants", metres(orderExtra(months), 1)],
        ["and the rope to order is", metres(orderLength(depth, headgear, dead, months))],
        ["a rope of this length serves", `${places(servesFor(have, depth + headgear + dead), 0)} months`],
        ["capping every six months is", verdict(capped(RECAP_MONTHS))],
      ],
    ),
    "",
    ...heading("the end that does the work"),
    ...table(
      [left(""), right("")],
      [
        ["the length over the sheave every wind", metres(busyLength(headgear, dead))],
        ["which is, of the whole rope", share(busyShare(headgear, dead, have))],
        ["shifting it through in eight cuts", metres(shiftFor(headgear, dead, 8), 1)],
      ],
    ),
    "",
    ...heading("what each capping keeps"),
    ...table(
      [left("capping"), right("keeps"), right("holds"), left("for winding")],
      (Object.keys(CAPPINGS) as (keyof typeof CAPPINGS)[]).map((each) => [
        spaced(each),
        share(keeps(each)),
        force(heldBy(one, each)),
        verdict(goodForWinding(each)),
      ]),
    ),
  ];

  return blocks(
    out,
    [line("a capel is remade every", `${places(RECAP_MONTHS, 0)} months`)],
    wrapped(
      "The cut-back at each recapping is not merely maintenance. It moves the whole rope through " +
        "the machine and puts fresh rope where the sheave was working, which is the principal " +
        "means of getting a full life out of one — and it is also the clock that decides when a " +
        "sound rope has to be thrown away for being too short.",
    ),
  );
}
