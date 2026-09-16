/**
 * `sheave cost` — what winding costs, and the day down that costs more.
 *
 * A winding installation is cheap to run and expensive to stop. The
 * electricity is a few pence a tonne and so is the rope; the men on the
 * bank are rather more than either; and the day the winder is down the
 * whole colliery is down, which is the number that decides everything.
 */

import { readFileSync } from "node:fs";
import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, word } from "../args.ts";
import { parseWinder } from "../../winder/parse.ts";
import {
  aDay,
  aDayDown,
  biggerDrumWorth,
  changeCost,
  changeEvery,
  describeCost,
  energyAYear,
  lines,
  menPerTonne,
  perTonne,
  powerAYear,
  powerPerTonne,
  prices,
  ropeCost,
  ropePerTonne,
  secondWorth,
} from "../../costing/works.ts";
import { outputPerDay, ropeWanted } from "../../winder/index.ts";
import { heading, line, pence, places, pounds, share, wrapped } from "../../report/format.ts";
import { barOf, blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["power", "rope", "shift", "men", "changeshifts", "margin", "days", "bars"];

/** Run it. */
export function costCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = parseWinder(readFileSync(word(args, 0, "a winder file"), "utf8"));
  const at = prices({
    power: number(args, "power", 9),
    rope: number(args, "rope", 2400),
    shift: number(args, "shift", 42_000),
    men: number(args, "men", 640),
    changeShifts: number(args, "changeshifts", 1.5),
  });
  const margin = number(args, "margin", 8);
  const days = number(args, "days", 300);
  const found = lines(one, at);
  const whole = perTonne(one, at);
  const bar = (value: number): string => (flag(args, "bars") ? ` ${barOf(value / whole, 20)}` : "");

  const out: string[] = [
    ...heading(describeCost(one, at)),
    ...table(
      [left(""), right("pence a tonne"), right("share")],
      [
        ["electricity", pence(powerPerTonne(one, at)) + bar(found.power ?? 0), share((found.power ?? 0) / whole)],
        ["rope", pence(ropePerTonne(one, at)) + bar(found.rope ?? 0), share((found.rope ?? 0) / whole)],
        ["men", pence(menPerTonne(one, at)) + bar(found.men ?? 0), share((found.men ?? 0) / whole)],
        ["", "", ""],
        ["altogether", pence(whole), share(1)],
      ],
    ),
    "",
    ...heading("the rope as a capital item"),
    ...table(
      [left(""), right("")],
      [
        ["a rope costs", pounds(ropeCost(one.rope, ropeWanted(one), at))],
        ["changing one costs", pounds(changeCost(one.rope, ropeWanted(one), at))],
        ["of which the rope itself is", share(ropeCost(one.rope, ropeWanted(one), at) / changeCost(one.rope, ropeWanted(one), at))],
        ["and it is changed every", `${places(changeEvery(one, at), 0)} days`],
      ],
    ),
    "",
    ...heading("what a saving is worth"),
    ...table(
      [left(""), right("")],
      [
        ["a day of winding costs", pounds(aDay(one, at))],
        ["a day down costs", pounds(aDayDown(at))],
        ["a ten per cent bigger drum saves", `${pounds(biggerDrumWorth(one, 0.1, at, days))} a year`],
        [`a second off the standing time, at ${pounds(margin)} a tonne`, `${pounds(secondWorth(one, margin, at, days))} a year`],
        ["the electricity comes to", `${pounds(powerAYear(one, at, days))} a year`],
        ["on", `${places(energyAYear(one, days) / 1e6, 2)} GWh`],
        ["the colliery raises", `${places((outputPerDay(one) * days) / 1000, 0)} thousand tonnes a year`],
      ],
    ),
  ];

  return blocks(
    out,
    [line("prices used", `power ${places(at.power, 1)}p/kWh, rope ${pounds(at.rope)}/t, a shift ${pounds(at.shift)}`)],
    wrapped(
      "The rope is a tenth of what a rope change costs and the colliery standing is the other " +
        "nine tenths, which is why a works will pay a great deal for a rope that lasts longer and " +
        "nothing at all for one that is cheaper. It is the clearest case in the subject of a " +
        "capital decision settled by a maintenance figure.",
    ),
  );
}
