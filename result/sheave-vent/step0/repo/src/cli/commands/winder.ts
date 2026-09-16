/**
 * `sheave winder` — a whole installation, read from a file.
 *
 * The command that ties the rest together. A winder file is what an
 * engineer would have written on the back of the certificate, and this
 * reads one and says what the installation it describes is doing — the
 * rope, the drum, the conveyances, the cycle, the engine and the output,
 * on one sheet.
 *
 * It is also the only sort of command in the program that opens a file,
 * which is deliberate: everything below the command line is arithmetic
 * on values and can be tested by calling it.
 */

import { readFileSync } from "node:fs";
import type { Args } from "../args.ts";
import { flag, onlyKnown, word } from "../args.ts";
import { parseWinder } from "../../winder/parse.ts";
import {
  balanceSwing,
  cycleLasts,
  deadShare,
  describeWinder,
  drumOf,
  energyADay,
  energyATonne,
  factor,
  factorWanted,
  hangingLoad,
  inertiaOf,
  motor,
  outputPerDay,
  outputPerHour,
  outputPerYear,
  peak,
  rms,
  ropeMargin,
  ropeStrongEnough,
  ropeWanted,
  windLasts,
  windLength,
  windsPerHour,
} from "../../winder/model.ts";
import { breakingLoad, lifeIn, massPerMetre } from "../../rope/index.ts";
import { capacity, fleetAngle } from "../../drum/cylindrical.ts";
import { gross, usefulFraction } from "../../cage/index.ts";
import {
  degrees,
  energy,
  factor as sayFactor,
  force,
  heading,
  line,
  metres,
  millimetres,
  perDay,
  perHour,
  perMetre,
  places,
  power,
  seconds,
  share,
  speed,
  tonnes,
  verdict,
  winds,
} from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["year"];

/** Run it. */
export function winderCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = parseWinder(readFileSync(word(args, 0, "a winder file"), "utf8"));
  const isDrum = one.drive.kind === "drum";

  const out: string[] = [
    ...heading(describeWinder(one)),
    ...heading("the rope"),
    ...table(
      [left(""), right("")],
      [
        ["diameter", millimetres(one.rope.diameter)],
        ["construction", one.rope.construction.name],
        ["breaking load", force(breakingLoad(one.rope))],
        ["it weighs", perMetre(massPerMetre(one.rope))],
        ["the wind wants", metres(ropeWanted(one))],
        ["hanging load", force(hangingLoad(one))],
        ["factor of safety", sayFactor(factor(one))],
        ["the depth demands", sayFactor(factorWanted(one))],
        ["strong enough", verdict(ropeStrongEnough(one))],
        ["margin left on it", share(ropeMargin(one))],
      ],
    ),
    "",
    ...heading(isDrum ? "the drum" : "the friction wheel"),
    ...table(
      [left(""), right("")],
      isDrum
        ? [
            ["barrel", `${metres(drumOf(one).diameter, 2)} by ${metres(drumOf(one).width, 2)}`],
            ["layers", places(drumOf(one).layers, 0)],
            ["rope it holds", metres(capacity(drumOf(one), one.rope))],
            ["fleet angle", degrees(fleetAngle(drumOf(one)))],
            ["life the rope gets", `${winds(lifeIn(one.rope, drumOf(one).diameter))} winds`],
            ["what the rotating parts weigh", tonnes(inertiaOf(one))],
          ]
        : [["a friction winder", "see the koepe command"]],
    ),
    "",
    ...heading("the conveyances"),
    ...table(
      [left(""), right("rising"), right("falling")],
      [
        ["what it is", one.rising.kind, one.falling.kind],
        ["tare", tonnes(one.rising.tare), tonnes(one.falling.tare)],
        ["payload", tonnes(one.rising.payload), tonnes(one.falling.payload)],
        ["gross", tonnes(gross(one.rising)), tonnes(gross(one.falling))],
        ["useful fraction", share(usefulFraction(one.rising)), "—"],
      ],
    ),
    "",
    ...heading("the cycle and the engine"),
    ...table(
      [left(""), right("")],
      [
        ["the wind", metres(windLength(one))],
        ["full speed", speed(one.profile.full)],
        ["the wind lasts", seconds(windLasts(one))],
        ["the cycle lasts", seconds(cycleLasts(one))],
        ["winds an hour", places(windsPerHour(one), 2)],
        ["out-of-balance swing", force(balanceSwing(one))],
        ["peak power", power(peak(one))],
        ["r.m.s. power", power(rms(one))],
        ["motor", power(motor(one))],
      ],
    ),
    "",
    ...heading("what it raises"),
    ...table(
      [left(""), right("")],
      [
        ["an hour", perHour(outputPerHour(one))],
        ["a day, over " + places(one.hours, 0) + " hours", perDay(outputPerDay(one))],
        ["dead weight in what it lifts", share(deadShare(one))],
        ["energy a tonne", energy(energyATonne(one))],
        ["energy a day", `${places(energyADay(one), 0)} kWh`],
      ],
    ),
  ];

  if (flag(args, "year")) {
    out.push(
      "",
      line("a year of it, over 300 days", `${places(outputPerYear(one) / 1000, 0)} thousand tonnes`),
      line("and the energy", `${places((energyADay(one) * 300) / 1e6, 2)} GWh`),
    );
  }

  return blocks(out);
}
