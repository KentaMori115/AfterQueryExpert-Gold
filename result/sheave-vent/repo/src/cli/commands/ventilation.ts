/**
 * `sheave ventilation` — what the air costs, once the winding has had
 * its share of the shaft.
 *
 * The shaft command says how many square metres the conveyances leave
 * the air. This says what the fan pays for them, where the fan and the
 * colliery settle, and which of the three demands — the men, the coal
 * or the gas — is the one deciding how much air the pit is asked for.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import { shaft, area, airSpeed, comfortable, freeArea, BRISK_AIR } from "../../shaft/shaft.ts";
import {
  A_MAN_WANTS,
  A_TONNE_WANTS,
  FRICTION,
  GAS_LIMIT,
  airPower,
  decidedBy,
  deepestVentilated,
  describeAirway,
  fan,
  fanPower,
  inSeries,
  naturalPressure,
  operatingPoint,
  resistance,
  shaftAirway,
  splitBetween,
  stiffestFor,
  velocity,
  wanted,
} from "../../air/index.ts";
import { heading, line, metres, places, share, speed, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = [
  "diameter",
  "depth",
  "conveyances",
  "width",
  "across",
  "pipes",
  "friction",
  "workings",
  "men",
  "tonnes",
  "gas",
  "shutoff",
  "delivery",
  "efficiency",
  "upcast",
  "split",
  "widen",
];

/** Run it. */
export function ventilationCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = shaft(
    "the downcast",
    option(args, "diameter") === undefined ? 7.3 : quantity(args, "diameter"),
    option(args, "depth") === undefined ? 942 : quantity(args, "depth"),
    number(args, "conveyances", 2),
  );
  const width = option(args, "width") === undefined ? 2.2 : quantity(args, "width");
  const across = option(args, "across") === undefined ? 1.5 : quantity(args, "across");
  const pipes = option(args, "pipes") === undefined ? 1.2 : quantity(args, "pipes");
  const friction = number(args, "friction", FRICTION);
  const workings = number(args, "workings", 0.03);
  const blowing = fan(
    "the fan",
    number(args, "shutoff", 3500),
    number(args, "delivery", 400),
    number(args, "efficiency", 0.7),
  );

  const down = shaftAirway(one, width, across, pipes, friction);
  const circuit = inSeries([resistance(down), workings]);
  const natural = option(args, "upcast") === undefined ? 0 : naturalPressure(one.depth, 1.2, number(args, "upcast", 1.1));
  const at = operatingPoint(blowing, circuit, natural);
  const men = number(args, "men", 900);
  const tonnes = number(args, "tonnes", 3000);
  const gas = number(args, "gas", 1.5);
  const asked = wanted(men, tonnes, gas);

  const rows: Array<readonly [string, string]> = [
    ["shaft section", `${places(area(one), 1)} m²`],
    ["what the winding leaves the air", `${places(freeArea(one, width, across, pipes), 1)} m²`],
    ["resistance of the shaft", places(resistance(down), 6)],
    ["and of the workings behind it", places(workings, 6)],
    ["the fan and the pit settle at", `${places(at.quantity, 1)} m³/s`],
    ["against a pressure of", `${places(at.pressure, 0)} Pa`],
    ["which is, in the air", `${places(airPower(at.pressure, at.quantity), 1)} kW`],
    ["and at the fan shaft", `${places(fanPower(blowing, circuit, natural), 1)} kW`],
  ];

  if (natural > 0) rows.push(["the warm upcast is worth", `${places(natural, 0)} Pa of it`]);

  const asking: Array<readonly [string, string]> = [
    ["men underground", places(men, 0)],
    ["wound in a day", `${places(tonnes, 0)} t`],
    ["gas made", `${places(gas, 2)} m³/s`],
    ["so the pit is asking for", `${places(asked, 1)} m³/s`],
    ["and it is", `the ${decidedBy(men, tonnes, gas)} that is asking`],
    ["the fan delivers it", verdict(at.quantity >= asked)],
    ["short by", `${places(Math.max(0, asked - at.quantity), 1)} m³/s`],
    ["air past the conveyances", speed(airSpeed(one, at.quantity, width, across))],
    ["men can ride in that", verdict(comfortable(one, at.quantity, width, across))],
    ["most they could ride in", `${places(freeArea(one, width, across, pipes) * BRISK_AIR, 0)} m³/s`],
  ];

  if (asked < blowing.delivery && stiffestFor(blowing, asked) > workings) {
    asking.push([
      "deepest this fan would carry",
      metres(deepestVentilated(blowing, freeArea(one, width, across, pipes), Math.PI * one.diameter, asked, workings, friction)),
    ]);
  } else {
    asking.push(["deepest this fan would carry", "no depth at all: this fan is beaten before it starts"]);
  }

  const out: string[] = [
    ...heading(describeAirway(down)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading("what the pit is asking for"),
    ...table([left(""), right("")], asking.map((each) => [each[0], each[1]])),
  ];

  if (flag(args, "split")) {
    const districts = [workings, workings * 2, workings * 5];
    const shares = splitBetween(at.quantity, districts);
    out.push(
      "",
      ...heading("three districts side by side"),
      ...table(
        [left("district"), right("resistance"), right("takes"), right("of the whole")],
        districts.map((each, index) => [
          ["the short level", "the middle level", "the far face"][index] as string,
          places(each, 4),
          `${places(shares[index] as number, 1)} m³/s`,
          share((shares[index] as number) / at.quantity),
        ]),
      ),
    );
  }

  if (flag(args, "widen")) {
    const now = freeArea(one, width, across, pipes);
    out.push(
      "",
      ...heading("a wider conveyance, and what the fan pays for it"),
      ...table(
        [left("width"), right("free area"), right("costs the fan")],
        [2.2, 2.4, 2.6, 2.8].map((each) => {
          const then = freeArea(one, each, across, pipes);
          return [
            metres(each, 2),
            `${places(then, 1)} m²`,
            `${places((now * now * now) / (then * then * then), 3)} to one`,
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [
      line("a man underground wants", `${places(A_MAN_WANTS, 2)} m³/s`),
      line("a tonne of the day's coal wants", `${places(A_TONNE_WANTS, 2)} m³/s`),
      line("and the gas is held under", share(GAS_LIMIT)),
      line("air is brisk to ride in above", speed(BRISK_AIR)),
      line("the air itself goes down at", speed(velocity(down, at.quantity))),
    ],
    wrapped(
      "Resistance goes as the cube of the section, so the argument between the winding and the " +
        "ventilation is not a close one: a tenth off the section is worth a third of the fan " +
        "bill. The other half of it is that air takes the easy road, so what a district " +
        "gets is not what the plan says but what the square roots say, and nearly all of the work " +
        "in a ventilation plan is stopping air going where it wants to go.",
    ),
  );
}
