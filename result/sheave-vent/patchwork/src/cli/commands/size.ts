/**
 * `sheave size` — an installation for a duty, in one direction.
 *
 * The cycle decides the payload; the payload decides the conveyance;
 * the conveyance and the depth decide the rope; the rope decides the
 * drum; the conveyance decides the shaft. It reads like a loop and it
 * is not one — every arrow points forward. The feedback everybody
 * expects, a bigger rope weighing more and wanting a bigger rope, lives
 * one level down inside the search for a diameter.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  cycleOf,
  deepestFor,
  describeSized,
  drumFor,
  drumHolds,
  factorDemanded,
  factorGiven,
  headgearFor,
  payloadFor,
  raises,
  ropeTonnes,
  shaftWidthFor,
  sizeFor,
  sumpFor,
  tareShare,
  turnsOnIt,
} from "../../design/sizing.ts";
import { profile } from "../../cycle/index.ts";
import { breakingLoad, massPerMetre } from "../../rope/index.ts";
import { fleetAngle } from "../../drum/cylindrical.ts";
import {
  degrees,
  factor as sayFactor,
  force,
  heading,
  line,
  metres,
  millimetres,
  perHour,
  perMetre,
  places,
  seconds,
  share,
  tonnes,
  verdict,
  wrapped,
} from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["output", "depth", "kind", "full", "rest", "accelerate", "compare", "sweep"];

/** Run it. */
export function sizeCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const wanted = number(args, "output", 350);
  const depth = option(args, "depth") === undefined ? 942 : quantity(args, "depth");
  const kind = (option(args, "kind") ?? "skip") === "cage" ? "cage" : "skip";
  const how = profile({
    full: option(args, "full") === undefined ? 15 : quantity(args, "full"),
    rest: option(args, "rest") === undefined ? 25 : quantity(args, "rest"),
    accelerate: number(args, "accelerate", 1),
  });
  const one = sizeFor(wanted, depth, kind, how);

  const out: string[] = [
    ...heading(describeSized(one)),
    ...table(
      [left(""), right("")],
      [
        ["the payload the cycle wants", tonnes(payloadFor(wanted, depth, how))],
        ["so the conveyance is", `${tonnes(one.conveyance.tare)} tare on ${tonnes(one.conveyance.payload)}`],
        ["which for a " + kind + " is a tare of", places(tareShare(kind), 2) + " times the payload"],
        ["the rope", millimetres(one.rope.diameter) + " " + one.rope.construction.name],
        ["breaking at", force(breakingLoad(one.rope))],
        ["weighing", perMetre(massPerMetre(one.rope))],
        ["so the rope alone is", tonnes(ropeTonnes(one) * 1000)],
        ["factor of safety it gives", sayFactor(factorGiven(one))],
        ["the depth demands", sayFactor(factorDemanded(one))],
        ["the drum", `${metres(one.drum.diameter, 2)} by ${metres(one.drum.width, 2)} in ${places(one.drum.layers, 0)} layers`],
        ["turns on one layer", places(turnsOnIt(one), 0)],
        ["which holds the rope", verdict(drumHolds(one))],
        ["fleet angle at that lead", degrees(fleetAngle(one.drum))],
        ["the shaft", metres(one.shaft.diameter, 1)],
        ["the width the conveyances want", metres(shaftWidthFor(one.conveyance.width), 2)],
        ["the sump", metres(one.shaft.sump, 0)],
        ["the headgear", metres(one.shaft.headgear, 0)],
        ["the cycle", seconds(cycleOf(one))],
        ["and it raises", perHour(raises(one))],
      ],
    ),
    "",
    line("the sump a " + places(how.full, 0) + " m/s winder wants", metres(sumpFor(how.full), 0)),
    line("and the headgear", metres(headgearFor(how.full), 0)),
    line("deepest this duty can be wound in one lift", metres(deepestFor(wanted, kind, how))),
  ];

  if (flag(args, "compare")) {
    out.push(
      "",
      ...heading("the same duty in cages and in skips"),
      ...table(
        [left(""), right("cages"), right("skips")],
        (() => {
          const asCage = sizeFor(wanted, depth, "cage", how);
          const asSkip = sizeFor(wanted, depth, "skip", how);
          return [
            ["payload", tonnes(asCage.conveyance.payload), tonnes(asSkip.conveyance.payload)],
            ["tare", tonnes(asCage.conveyance.tare), tonnes(asSkip.conveyance.tare)],
            ["rope", millimetres(asCage.rope.diameter), millimetres(asSkip.rope.diameter)],
            ["rope weighs", tonnes(ropeTonnes(asCage) * 1000), tonnes(ropeTonnes(asSkip) * 1000)],
            ["drum", metres(asCage.drum.diameter, 1), metres(asSkip.drum.diameter, 1)],
            ["shaft", metres(asCage.shaft.diameter, 1), metres(asSkip.shaft.diameter, 1)],
            ["deepest in one lift", metres(deepestFor(wanted, "cage", how)), metres(deepestFor(wanted, "skip", how))],
          ];
        })(),
      ),
    );
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what the depth does to the installation"),
      ...table(
        [right("depth"), right("payload"), right("rope"), right("drum"), right("shaft")],
        [400, 700, 1000, 1400, 1800].map((each) => {
          try {
            const trial = sizeFor(wanted, each, kind, how);
            return [
              metres(each),
              tonnes(trial.conveyance.payload),
              millimetres(trial.rope.diameter),
              metres(trial.drum.diameter, 1),
              metres(trial.shaft.diameter, 1),
            ];
          } catch {
            return [metres(each), "—", "no rope will do it", "—", "—"];
          }
        }),
      ),
    );
  }

  return blocks(
    out,
    wrapped(
      "It refuses rather than approximates. If no rope this library knows will hang that " +
        "conveyance at that depth, the answer is that the duty wants two lifts and not that the " +
        "rope is ninety-one millimetres.",
    ),
  );
}
