/**
 * `sheave koepe` — the friction winder, and the ratio it lives inside.
 *
 * Koepe's idea was to stop winding the rope onto anything: it passes
 * over a lined wheel and is driven by friction alone. Nothing is
 * coiled, so the depth costs nothing in drum size and the fleet angle
 * does not exist. What it costs is the capstan equation, which is the
 * oldest piece of arithmetic on a ship and turns up here unchanged.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  MOST_PRESSURE,
  ROPE_SHARE_ERROR,
  SLIP_MARGIN,
  balanceRopeFor,
  balancedTensions,
  deepestDriving,
  describeKoepe,
  hangingNeeded,
  koepe,
  leastWheel,
  liningPressure,
  liningStands,
  mostRatio,
  ratioAt,
  tensions,
  wheelBigEnough,
  willDrive,
  workingRatio,
  worstRatio,
  worstRope,
  wrapNeeded,
} from "../../drum/koepe.ts";
import { constructionNamed, massPerMetre, rope } from "../../rope/index.ts";
import { conveyance, gross, skip } from "../../cage/index.ts";
import { weightOf } from "../../units/measure.ts";
import { degrees, force, heading, line, metres, perMetre, places, ratio, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "wrap", "friction", "ropes", "rope", "depth", "rising", "falling", "balance", "sweep"];

/** Run it. */
export function koepeCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = koepe(
    option(args, "diameter") === undefined ? 5 : quantity(args, "diameter"),
    number(args, "wrap", 180),
    number(args, "friction", 0.25),
    number(args, "ropes", 4),
  );
  const line0 = rope(
    option(args, "rope") === undefined ? 32 : quantity(args, "rope") * 1000,
    constructionNamed("6x36"),
    1960,
  );
  const depth = option(args, "depth") === undefined ? 900 : quantity(args, "depth");
  const loaded = option(args, "rising") === undefined ? skip(12_000) : skip(quantity(args, "rising"));
  const empty = conveyance({ name: "the empty one", kind: "skip", tare: loaded.tare, payload: 0, decks: 1, width: 2.2, across: 1.8 });
  const rising = weightOf(gross(loaded));
  const falling = weightOf(gross(empty));
  const balance = number(args, "balance", 0);

  const bare = tensions(line0, depth, rising, falling, depth);
  const balanced = balancedTensions(line0, depth, rising, falling);

  const rows: Array<readonly [string, string]> = [
    ["wheel diameter", metres(one.diameter, 2)],
    ["which the rope wants at least", metres(leastWheel(line0), 2)],
    ["large enough", verdict(wheelBigEnough(one, line0))],
    ["wrap", degrees(one.wrap)],
    ["friction of the lining", ratio(one.friction)],
    ["so the capstan equation allows", ratio(mostRatio(one))],
    ["and the rules allow", ratio(workingRatio(one))],
    ["ropes", places(one.ropes, 0)],
    ["worst rope of the set carries", force(worstRope(one, bare.taut + bare.slack))],
  ];

  const out: string[] = [
    ...heading(describeKoepe(one)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading(`hanging ${force(rising)} against ${force(falling)} at ${metres(depth)}`),
    ...table(
      [left(""), right("no balance rope"), right("with one")],
      [
        ["taut side", force(bare.taut), force(balanced.taut)],
        ["slack side", force(bare.slack), force(balanced.slack)],
        ["ratio", ratio(ratioAt(bare.taut, bare.slack)), ratio(ratioAt(balanced.taut, balanced.slack))],
        ["worst ratio anywhere in the wind", ratio(worstRatio(line0, depth, rising, falling)), ratio(ratioAt(balanced.taut, balanced.slack))],
        ["it drives", verdict(willDrive(one, bare.taut, bare.slack)), verdict(willDrive(one, balanced.taut, balanced.slack))],
        [
          "lining pressure",
          `${places(liningPressure(one, line0, bare.taut, bare.slack), 2)} N/mm²`,
          `${places(liningPressure(one, line0, balanced.taut, balanced.slack), 2)} N/mm²`,
        ],
        [
          "which the lining stands",
          verdict(liningStands(one, line0, bare.taut, bare.slack)),
          verdict(liningStands(one, line0, balanced.taut, balanced.slack)),
        ],
      ],
    ),
    "",
    line("deepest it drives with no balance rope", metres(deepestDriving(one, line0, rising, falling))),
    line("hanging rope the wind wants", perMetre(hangingNeeded(one, depth, rising, falling))),
    line("of which the winding rope is", perMetre(massPerMetre(line0) * one.ropes)),
    line("so the balance rope wants", perMetre(Math.max(0, hangingNeeded(one, depth, rising, falling) - massPerMetre(line0) * one.ropes))),
    line("or, instead, a wrap of", degrees(wrapNeeded(one, balanced.taut, balanced.slack))),
    line("a matched balance rope would be", perMetre(balanceRopeFor(line0, one.ropes))),
    line("and the one given is", perMetre(balance)),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("through the wind, with no balance rope"),
      ...table(
        [right("to go"), right("taut"), right("slack"), right("ratio"), left("drives")],
        [0, 0.25, 0.5, 0.75, 1].map((at) => {
          const found = tensions(line0, depth, rising, falling, depth * at);
          return [
            metres(depth * at),
            force(found.taut),
            force(found.slack),
            ratio(ratioAt(found.taut, found.slack)),
            verdict(willDrive(one, found.taut, found.slack)),
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [
      line("the rules keep a margin of", ratio(SLIP_MARGIN)),
      line("a lining stands", `${places(MOST_PRESSURE, 1)} N/mm²`),
      line("and one rope of a set may carry", `${places(ROPE_SHARE_ERROR * 100, 0)}% more than its share`),
    ],
    wrapped(
      "The rope makes the ratio worse and not better, which is the opposite of what one expects. " +
        "The worst moment of the wind is the one where the slack side has no rope beneath the " +
        "wheel at all, because its conveyance is at the top and all the rope is on the other " +
        "side. So depth hurts a friction winder in direct proportion, and the balance rope is " +
        "what answers it.",
    ),
  );
}
