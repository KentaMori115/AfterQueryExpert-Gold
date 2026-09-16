/**
 * `sheave guides` — what keeps a conveyance from swinging.
 *
 * A cage hanging on a kilometre of rope is a pendulum with a very long
 * period and almost no damping. At thirty miles an hour in a shaft with
 * a hand's breadth of clearance it does not swing for long, so it runs
 * between guides — and the two sorts behave so differently that a shaft
 * changed from one to the other is a different shaft.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  GUIDE_FACTOR,
  MOST_SWAY,
  OUT_OF_SQUARE,
  SHOE_SPAN,
  buntonDrag,
  buntons,
  describeGuides,
  guideFactor,
  guideStrongEnough,
  guides,
  lateralLoad,
  ropeStiffness,
  staysClear,
  stiffnessRange,
  sway,
  swingPeriod,
  tensionAt,
  tensionFor,
} from "../../shaft/guides.ts";
import { constructionNamed, rope } from "../../rope/index.ts";
import { factor as sayFactor, force, heading, line, metres, places, share, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["sort", "number", "spacing", "tension", "depth", "gross", "diameter", "span", "shaft", "sweep"];

/** Run it. */
export function guidesCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const sort = (option(args, "sort") ?? "rope") === "rigid" ? "rigid" : "rope";
  const one = guides(
    sort,
    number(args, "number", 4),
    option(args, "spacing") === undefined ? 6 : quantity(args, "spacing"),
    number(args, "tension", 90),
  );
  const depth = number(args, "depth", 942);
  const gross = option(args, "gross") === undefined ? 17_040 : quantity(args, "gross");
  const span = option(args, "span") === undefined ? (sort === "rope" ? SHOE_SPAN : one.spacing) : quantity(args, "span");
  const guideRope = rope(number(args, "diameter", 38), constructionNamed("6x19"), 1770);
  const lateral = lateralLoad(gross);

  const rows: Array<readonly [string, string]> = [
    ["sort", one.sort],
    ["how many", places(one.number, 0)],
    ["the conveyance weighs", `${places(gross / 1000, 2)} t`],
    ["the lateral load it makes", force(lateral, 2)],
    ["the span the stiffness works over", metres(span, 2)],
    ["sway it allows", `${places(sway(one, span, lateral) * 1000, 2)} mm`],
    ["inside the clearances", verdict(staysClear(one, span, lateral))],
  ];

  if (sort === "rope") {
    rows.push(
      ["stiffness of each guide", `${places(ropeStiffness(one, span), 1)} kN/m`],
      ["tension for five millimetres", force(tensionFor(span, lateral, one.number, 0.005), 0)],
      ["tension at the top of the shaft", force(tensionAt(guideRope, one, depth), 1)],
      ["so the guiding is stiffer at the top by", `${places(stiffnessRange(guideRope, one, depth), 2)} to one`],
      ["the guide rope's factor of safety", sayFactor(guideFactor(guideRope, depth, one.tension))],
      ["which is enough", verdict(guideStrongEnough(guideRope, depth, one.tension))],
    );
  } else {
    rows.push(
      ["bunton spacing", metres(one.spacing, 1)],
      ["sets in the shaft", places(buntons(one, depth), 0)],
      ["what they cost the ventilation", share(buntonDrag(one, depth, 7.3))],
    );
  }

  const out: string[] = [
    ...heading(describeGuides(one, depth)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    line("unguided, the conveyance swings with a period of", `${places(swingPeriod(depth), 1)} s`),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("the two sorts against each other"),
      ...table(
        [left("sort"), right("span"), right("sway"), left("clear")],
        [
          ["rope guides at 90 kN", metres(SHOE_SPAN, 1), `${places(sway(guides("rope", 4, 6, 90), SHOE_SPAN, lateral) * 1000, 2)} mm`, verdict(staysClear(guides("rope", 4, 6, 90), SHOE_SPAN, lateral))],
          ["rope guides at 200 kN", metres(SHOE_SPAN, 1), `${places(sway(guides("rope", 4, 6, 200), SHOE_SPAN, lateral) * 1000, 2)} mm`, verdict(staysClear(guides("rope", 4, 6, 200), SHOE_SPAN, lateral))],
          ["rigid on 6 m buntons", metres(6, 1), `${places(sway(guides("rigid", 4, 6, 0), 6, lateral) * 1000, 2)} mm`, verdict(staysClear(guides("rigid", 4, 6, 0), 6, lateral))],
          ["rigid on 9 m buntons", metres(9, 1), `${places(sway(guides("rigid", 4, 9, 0), 9, lateral) * 1000, 2)} mm`, verdict(staysClear(guides("rigid", 4, 9, 0), 9, lateral))],
        ],
      ),
    );
  }

  return blocks(
    out,
    [
      line("a conveyance is out of square by", share(OUT_OF_SQUARE)),
      line("its shoes are apart by", metres(SHOE_SPAN, 1)),
      line("and the clearances allow", `${places(MOST_SWAY * 1000, 0)} mm of sway`),
      line("a guide rope works at a factor of", sayFactor(GUIDE_FACTOR)),
    ],
    wrapped(
      "A rope guide's stiffness comes entirely from its tension and not at all from the steel in " +
        "it, so a colliery that wants stiffer rope guides hangs more weight in the sump rather " +
        "than ordering thicker rope. And the span the string formula wants is the conveyance's " +
        "own shoes and not the depth of the shaft: put the depth in and the answer comes out two " +
        "hundred times too soft.",
    ),
  );
}
