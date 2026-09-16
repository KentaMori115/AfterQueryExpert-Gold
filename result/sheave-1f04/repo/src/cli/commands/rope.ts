/**
 * `sheave rope` — what a rope stands and what it weighs.
 *
 * The two numbers everything else in the subject needs. The first is
 * obvious and the second is not, and the second is the one that decides
 * how deep a shaft can be wound: a rope long enough to reach the bottom
 * of a deep shaft is mostly engaged in holding itself up, and at some
 * depth it is engaged in nothing else.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  CONSTRUCTIONS,
  GRADES,
  breakingLength,
  breakingLoad,
  constructionNamed,
  deepestEmpty,
  describeRope,
  diameterFor,
  lockedCoilGain,
  massPerMetre,
  outerWire,
  rope,
  ropeMass,
  ropeWeight,
  steelArea,
  wireCount,
} from "../../rope/construction.ts";
import { deepestFor, factorAt, factorFor, mostHanging, mostHangingOver, ownShare, staticRopeLoad } from "../../rope/wear.ts";
import { weightOf } from "../../units/measure.ts";
import {
  factor as sayFactor,
  force,
  heading,
  kilograms,
  line,
  metres,
  millimetres,
  perMetre,
  places,
  share,
  spaced,
  stress,
  tonnes,
  tonsForce,
  wrapped,
} from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "construction", "grade", "depth", "hanging", "constructions", "sweep"];

/** Run it. */
export function ropeCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const made = constructionNamed(option(args, "construction") ?? "6x36");
  const diameter = option(args, "diameter") === undefined ? 40 : quantity(args, "diameter") * 1000;
  const one = rope(Math.round(diameter * 1000) / 1000, made, number(args, "grade", 1960));
  const depth = number(args, "depth", 900);
  const hanging = option(args, "hanging") === undefined ? weightOf(20_000) : weightOf(quantity(args, "hanging"));

  const rows: Array<readonly [string, string]> = [
    ["diameter", millimetres(one.diameter)],
    ["construction", one.construction.name],
    ["wires in it", places(wireCount(one.construction), 0)],
    ["each outer wire", `${places(outerWire(one), 2)} mm`],
    ["steel in the section", `${places(steelArea(one), 0)} mm²`],
    ["breaking load", force(breakingLoad(one))],
    ["the same in the maker's table", tonsForce(breakingLoad(one))],
    ["it weighs", perMetre(massPerMetre(one))],
    ["a hundred metres of it", kilograms(ropeMass(one, 100))],
    ["and pulls with", force(ropeWeight(one, 100))],
    ["breaking length", metres(breakingLength(one))],
    ["deepest carrying nothing, at 8", metres(deepestEmpty(one))],
  ];

  const out: string[] = [
    ...heading(describeRope(one)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading(`at ${metres(depth)} hanging ${force(hanging)}`),
    ...table(
      [left(""), right("")],
      [
        ["the rope's own weight", force(staticRopeLoad(one, depth))],
        ["of the whole load that is", share(ownShare(one, depth, hanging))],
        ["factor of safety", sayFactor(factorAt(one, depth, hanging))],
        ["the depth demands", sayFactor(factorFor(depth))],
        ["most it may hang here", force(mostHanging(one, depth))],
        ["and over the range to 1400 m", force(mostHangingOver(one, depth, Math.max(depth, 1400)))],
        ["deepest it will hang this load", metres(deepestFor(one, hanging))],
      ],
    ),
    "",
    line("a rope for that load wants", millimetres(diameterFor(hanging * factorFor(depth), made, one.grade))),
    line("locked coil would be stronger by", share(lockedCoilGain(one.diameter, one.grade))),
  ];

  if (flag(args, "constructions")) {
    out.push(
      "",
      ...heading("what a winding rope is made in"),
      ...table(
        [left("construction"), right("wires"), right("fill"), right("breaking"), right("weight"), right("outer wire")],
        Object.values(CONSTRUCTIONS).map((each) => {
          const trial = rope(one.diameter, each, one.grade);
          return [
            spaced(each.name),
            places(wireCount(each), 0),
            share(each.fill),
            force(breakingLoad(trial)),
            perMetre(massPerMetre(trial)),
            `${places(outerWire(trial), 2)} mm`,
          ];
        }),
      ),
    );
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("across the diameters"),
      ...table(
        [right("diameter"), right("breaking"), right("weight"), right("most at depth"), right("deepest")],
        [25, 32, 38, 46, 52, 60, 70].map((each) => {
          const trial = rope(each, made, one.grade);
          return [
            millimetres(each),
            force(breakingLoad(trial)),
            perMetre(massPerMetre(trial)),
            force(mostHanging(trial, depth)),
            metres(deepestFor(trial, hanging)),
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [line("the grades wire is drawn to", GRADES.join(", ") + " N/mm²"), line("this one", stress(one.grade))],
    wrapped(
      "The breaking length does not depend on the diameter at all: doubling it quadruples both the " +
        "strength and the weight. So a bigger rope does not reach deeper on its own account — it " +
        "reaches deeper only because it can carry a bigger conveyance, and at some depth it cannot " +
        "carry any conveyance whatever.",
    ),
  );
}
