/**
 * `sheave wear` — when a rope comes off, and why the rule's factor
 * falls with depth.
 *
 * A winding rope does not fail because somebody miscalculated the load.
 * It fails because it has been bent round a drum four hundred thousand
 * times, because the outer wires have worn flat, or because water down
 * the shaft has corroded the inside where nobody can look. The design
 * calculation is the easy half of the subject.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import { constructionNamed, rope } from "../../rope/construction.ts";
import {
  BROKEN_WIRES,
  DEEPEST_FACTOR,
  FACTOR_FALLS,
  LEAST_RATIO,
  LOCKED_RATIO,
  SHALLOW_FACTOR,
  WORN_DIAMETER,
  bendingStress,
  bigEnough,
  condemningBreaks,
  describeWear,
  factorAt,
  factorFor,
  leastDrum,
  lifeIn,
  lifeInMonths,
  mostHanging,
  ratioOf,
  staticRopeLoad,
  stillGood,
  strongEnough,
  wetShaftLife,
  wornOut,
  wornStrength,
} from "../../rope/wear.ts";
import { weightOf } from "../../units/measure.ts";
import {
  factor as sayFactor,
  force,
  heading,
  line,
  metres,
  millimetres,
  places,
  share,
  stress,
  verdict,
  winds,
  wrapped,
} from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "construction", "grade", "depth", "hanging", "drum", "measured", "wetness", "aday", "sweep"];

/** Run it. */
export function wearCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const made = constructionNamed(option(args, "construction") ?? "6x36");
  const diameter = option(args, "diameter") === undefined ? 40 : quantity(args, "diameter") * 1000;
  const one = rope(Math.round(diameter * 1000) / 1000, made, number(args, "grade", 1960));
  const depth = number(args, "depth", 900);
  const hanging = option(args, "hanging") === undefined ? weightOf(20_000) : weightOf(quantity(args, "hanging"));
  const drum = option(args, "drum") === undefined ? Math.max(leastDrum(one), 4) : quantity(args, "drum");
  const measured = number(args, "measured", one.diameter);
  const aDay = number(args, "aday", 400);

  const rows: Array<readonly [string, string]> = [
    ["factor of safety it works at", sayFactor(factorAt(one, depth, hanging))],
    ["the depth demands", sayFactor(factorFor(depth))],
    ["strong enough", verdict(strongEnough(one, depth, hanging))],
    ["the drum it is on", metres(drum, 2)],
    ["which is a ratio of", places(ratioOf(one, drum), 1)],
    ["the least allowed", places(one.construction.strands === 1 ? LOCKED_RATIO : LEAST_RATIO, 0)],
    ["large enough", verdict(bigEnough(one, drum))],
    ["bending in the outer wire", stress(bendingStress(one, drum))],
    ["life it should give", `${winds(lifeIn(one, drum))} winds`],
    ["which at that rate is", `${places(lifeInMonths(lifeIn(one, drum), aDay), 1)} months`],
    ["in a wet shaft", `${winds(wetShaftLife(one, drum))} winds`],
    ["condemned at", `${places(condemningBreaks(one), 0)} broken wires in a lay`],
    ["and at a diameter of", millimetres(wornOut(one))],
  ];

  const out: string[] = [
    ...heading(`a ${millimetres(one.diameter)} ${one.construction.name} at ${metres(depth)}`),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading(`measured at ${millimetres(measured)}`),
    ...table(
      [left(""), right("")],
      [
        ["it will still stand", force(wornStrength(one, measured))],
        ["which has lost", share(1 - wornStrength(one, measured) / wornStrength(one, one.diameter))],
        ["still to be worked", verdict(stillGood(one, measured, depth, hanging))],
      ],
    ),
    "",
    describeWear(one, measured, depth, hanging),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what the rule demands at each depth"),
      ...table(
        [right("depth"), right("factor"), right("rope's own"), right("most hanging")],
        [200, 500, 900, 1200, 1600, 2000].map((each) => [
          metres(each),
          sayFactor(factorFor(each)),
          force(staticRopeLoad(one, each)),
          force(mostHanging(one, each)),
        ]),
      ),
    );
  }

  return blocks(
    out,
    [
      line("the factor starts at", sayFactor(SHALLOW_FACTOR)),
      line("and falls by, a metre", places(FACTOR_FALLS, 4)),
      line("but never below", sayFactor(DEEPEST_FACTOR)),
      line("a rope is condemned at", share(BROKEN_WIRES) + " of its wires broken in a lay"),
      line("or when it has lost", share(WORN_DIAMETER) + " of its diameter"),
    ],
    wrapped(
      "The factor a rope must be put on at falls with the depth of the shaft, which reads like a " +
        "relaxation of standards and is not. It is an admission that at some depth a rope cannot " +
        "carry both a payload and eight times its own weight, and that a regulation demanding it " +
        "would forbid deep mining rather than make it safe.",
    ),
  );
}
