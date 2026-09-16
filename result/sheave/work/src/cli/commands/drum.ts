/**
 * `sheave drum` — the drum, the fleet angle, and the second layer.
 *
 * A cylindrical drum winds by coiling the rope onto itself, and the
 * rope has to lie in a helix that advances one diameter a turn. The
 * sheave it comes off is fixed while the coil moves along the drum, so
 * the rope runs at an angle that changes through the wind — and past
 * about a degree and a half it climbs over its neighbour and comes down
 * again with a bang that can be heard at the surface.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  DEAD_TURNS,
  MOST_FLEET,
  PITCH_OVER_DIAMETER,
  bigEnoughFor,
  capacity,
  crushing,
  deadRope,
  describeDrum,
  diameterFor,
  drum,
  fleetAngle,
  holdsIt,
  layerDiameter,
  layersFor,
  leadFor,
  liesDown,
  revolutions,
  ropeInLayer,
  ropeSpeed,
  speedCreep,
  turnsALayer,
  turnsFor,
} from "../../drum/cylindrical.ts";
import { constructionNamed, leastDrum, lifeIn, rope } from "../../rope/index.ts";
import { degrees, heading, line, metres, millimetres, places, share, speed, verdict, winds, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "width", "layers", "lead", "rope", "construction", "grade", "wants", "full", "sweep"];

/** Run it. */
export function drumCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const line0 = rope(
    option(args, "rope") === undefined ? 52 : quantity(args, "rope") * 1000,
    constructionNamed(option(args, "construction") ?? "6x36"),
    number(args, "grade", 1960),
  );
  const one = drum(
    option(args, "diameter") === undefined ? Math.max(leastDrum(line0), 4.2) : quantity(args, "diameter"),
    option(args, "width") === undefined ? 2.4 : quantity(args, "width"),
    number(args, "layers", 2),
    option(args, "lead") === undefined ? 46 : quantity(args, "lead"),
  );
  const wants = option(args, "wants") === undefined ? 984 : quantity(args, "wants");
  const full = option(args, "full") === undefined ? 15 : quantity(args, "full");

  const rows: Array<readonly [string, string]> = [
    ["barrel diameter", metres(one.diameter, 2)],
    ["which the rope wants at least", metres(diameterFor(line0), 1)],
    ["large enough", verdict(bigEnoughFor(one, line0))],
    ["barrel width", metres(one.width, 2)],
    ["turns in one layer", places(turnsALayer(one, line0), 0)],
    ["rope in the first layer", metres(ropeInLayer(one, line0, 1))],
    ["rope it holds altogether", metres(capacity(one, line0))],
    ["the wind wants", metres(wants)],
    ["which it holds", verdict(holdsIt(one, line0, wants))],
    ["layers that takes", places(layersFor(one, line0, wants), 0)],
    ["fleet angle", degrees(fleetAngle(one))],
    ["the rope lies down", verdict(liesDown(one))],
    ["the lead it wants", metres(leadFor(one), 1)],
    ["dead turns left on", metres(deadRope(one, line0), 1)],
    ["turns a whole wind takes", places(turnsFor(one, line0, wants), 1)],
    ["drum speed at full rope speed", `${places(revolutions(one, line0, full), 1)} rev/min`],
    ["life the rope gets on it", `${winds(lifeIn(line0, one.diameter))} winds`],
  ];

  const out: string[] = [
    ...heading(describeDrum(one, line0)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
  ];

  if (one.layers > 1) {
    out.push(
      "",
      ...heading("what the layers cost"),
      ...table(
        [right("layer"), right("diameter"), right("rope on it"), right("rope speed at that drum speed")],
        Array.from({ length: one.layers }, (_, at) => at + 1).map((at) => [
          places(at, 0),
          metres(layerDiameter(one, line0, at), 3),
          metres(ropeInLayer(one, line0, at)),
          speed(ropeSpeed(one, line0, revolutions(one, line0, full), at)),
        ]),
      ),
      "",
      line("so the rope speed creeps by", share(speedCreep(one, line0))),
      line("and the bottom coil is crushed at", `${places(crushing(one), 2)} times the tension`),
    );
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what a bigger drum buys"),
      ...table(
        [right("drum"), right("ratio"), right("life"), right("rope it holds")],
        [3, 3.6, 4.2, 4.8, 5.4, 6].map((each) => {
          const trial = drum(each, one.width, one.layers, one.lead);
          return [
            metres(each, 1),
            places((each * 1000) / line0.diameter, 1),
            winds(lifeIn(line0, each)),
            metres(capacity(trial, line0)),
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [
      line("a rope is coiled at a pitch of", `${places(PITCH_OVER_DIAMETER, 2)} diameters`),
      line("the fleet angle may not pass", degrees(MOST_FLEET)),
      line("and this many turns stay on", places(DEAD_TURNS, 0)),
      line("the rope on it is", millimetres(line0.diameter) + " " + line0.construction.name),
    ],
    wrapped(
      "A second layer is worse in every way: it crushes the first, it wears at the cross-over, and " +
        "it changes the effective radius so the rope speed changes without the engine doing " +
        "anything. It is used because a deep shaft wants more rope than one layer will hold, and " +
        "for no other reason at all.",
    ),
  );
}
