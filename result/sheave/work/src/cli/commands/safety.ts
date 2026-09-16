/**
 * `sheave safety` — the gear that does not trust the engineman.
 *
 * Every device here was invented after an accident. The two that matter
 * are the overwind and the overspeed, and both are guarded by machinery
 * that does not trust the man — which is not an insult to enginemen but
 * an admission that a man who winds four hundred times a shift for
 * thirty years will one day wind four hundred and one.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  ARRESTOR,
  EMERGENCY_BRAKE,
  EXAMINED_EVERY,
  OVERSPEED_MARGIN,
  RECAPPED_EVERY,
  WORKING_BRAKE,
  curveBegins,
  curveSpeed,
  describeGear,
  hookBand,
  hookHolds,
  hookLoad,
  hookPartsFirst,
  insideCurve,
  inspected,
  keps,
  kepsHold,
  kepsShare,
  retardationFor,
  stoppingDistance,
  stoppingTime,
  tripSpeed,
} from "../../safety/gear.ts";
import { profile } from "../../cycle/index.ts";
import { constructionNamed, breakingLoad, rope } from "../../rope/index.ts";
import { force, heading, line, metres, places, seconds, share, speed, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["full", "room", "rope", "working", "retardation", "delay", "keps", "rest", "sweep"];

/** Run it. */
export function safetyCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = profile({ full: option(args, "full") === undefined ? 15 : quantity(args, "full") });
  const room = option(args, "room") === undefined ? 32 : quantity(args, "room");
  const line0 = rope(
    option(args, "rope") === undefined ? 52 : quantity(args, "rope") * 1000,
    constructionNamed("6x36"),
    1960,
  );
  const working = option(args, "working") === undefined ? 260 : quantity(args, "working");
  const retardation = number(args, "retardation", EMERGENCY_BRAKE);
  const delay = number(args, "delay", 0.5);
  const catches = keps(number(args, "keps", 400), 3);
  const rest = option(args, "rest") === undefined ? 25 : quantity(args, "rest");
  const band = hookBand(breakingLoad(line0), working);

  const rows: Array<readonly [string, string]> = [
    ["winding speed", speed(one.full)],
    ["the overspeed gear trips at", speed(tripSpeed(one))],
    ["stopping distance from full speed", metres(stoppingDistance(one.full, retardation, delay), 1)],
    ["and the time it takes", seconds(stoppingTime(one.full, retardation, delay))],
    ["the retardation curve begins", `${metres(curveBegins(one, retardation, delay), 1)} out`],
    ["room above the bank", metres(room, 1)],
    ["retardation to stop in it", `${places(retardationFor(one.full, room, delay), 2)} m/s²`],
    ["which the arrestor gear gives", `${places(ARRESTOR, 2)} m/s²`],
    ["the emergency brake gives", `${places(EMERGENCY_BRAKE, 2)} m/s²`],
    ["and the working brake", `${places(WORKING_BRAKE, 2)} m/s²`],
    ["the detaching hook parts at", force(hookLoad(breakingLoad(line0)))],
    ["it must sit between", `${force(band.low)} and ${force(band.high)}`],
    ["it holds the working load", verdict(hookHolds(hookLoad(breakingLoad(line0)), working))],
    ["and parts before the rope", verdict(hookPartsFirst(breakingLoad(line0), hookLoad(breakingLoad(line0))))],
    ["the keps hold", force(catches.holds)],
    ["which is enough for the conveyance", verdict(kepsHold(catches, working))],
    ["and they take, of the standing time", share(kepsShare(catches, rest))],
    ["examinations kept as the rules ask", verdict(inspected(EXAMINED_EVERY, RECAPPED_EVERY))],
  ];

  const out: string[] = [
    ...heading(describeGear(one, room, breakingLoad(line0), working)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("the retardation curve near the landing"),
      ...table(
        [right("to go"), right("the curve allows"), left("full speed inside it")],
        [2, 5, 10, 20, 35, 55, 80].map((each) => [
          metres(each, 1),
          speed(curveSpeed(each, retardation, delay)),
          verdict(insideCurve(each, one.full, retardation, delay)),
        ]),
      ),
    );
  }

  return blocks(
    out,
    [
      line("the overspeed margin is", places(OVERSPEED_MARGIN, 2)),
      line("a rope is examined every", `${places(EXAMINED_EVERY, 0)} day`),
      line("and recapped every", `${places(RECAPPED_EVERY, 0)} months`),
    ],
    wrapped(
      "A single trip speed catches a winder running away in mid-shaft and does nothing at all " +
        "about one arriving at the landing at full speed, because full speed is not an overspeed. " +
        "So the gear carries a curve instead: at every distance from the landing there is a speed " +
        "above which the wind cannot be stopped in what is left, and it trips on that.",
    ),
  );
}
