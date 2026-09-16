/**
 * `sheave bounce` — the rope as a spring, and what a stop puts in it.
 *
 * The command that says why a deep winder cannot be landed where the
 * drum says it is. A kilometre of rope with a loaded skip on it
 * stretches better than a metre and a half and takes two or three
 * seconds to do it, so the conveyance is still moving after the winder
 * has stopped and is still moving when the brake goes on.
 *
 * The sweep is the part worth looking at. It walks the rope up the
 * shaft and shows the spring getting harder and the swinging mass
 * getting heavier at the same time, which is the fact behind the whole
 * of it: where the worst stop in a wind happens depends on whether
 * there is a balance rope, and the two answers are at opposite ends of
 * the shaft.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  DEEPEST_FACTOR,
  LAID_MODULUS,
  LOCKED_MODULUS,
  MOVING_THIRD,
  SUDDEN,
  bounceMass,
  bouncePeriod,
  bouncesAMinute,
  breakingLoad,
  constructionNamed,
  describeShock,
  describeSpring,
  goesSlack,
  hang,
  hardestDown,
  hardestUp,
  leastPull,
  ownStretch,
  peakPull,
  pullModulus,
  rope,
  shockFactor,
  slackRun,
  snatchPull,
  springRate,
  staticPull,
  steadyRise,
  stopShare,
  stretchUnder,
  wholeStretch,
} from "../../rope/index.ts";
import { weightOf } from "../../units/index.ts";
import { EMERGENCY_BRAKE } from "../../safety/index.ts";
import {
  factor as sayFactor,
  force,
  heading,
  line,
  metres,
  places,
  seconds,
  share,
  verdict,
  wrapped,
} from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["diameter", "construction", "grade", "ropes", "length", "carried", "balance", "speed", "retardation", "sweep"];

/** Run it. */
export function bounceCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const made = constructionNamed(option(args, "construction") ?? "6x36");
  const diameter = option(args, "diameter") === undefined ? 52 : quantity(args, "diameter") * 1000;
  const line0 = rope(Math.round(diameter * 1000) / 1000, made, number(args, "grade", 1960));
  const length = option(args, "length") === undefined ? 984 : quantity(args, "length");
  const carried = option(args, "carried") === undefined ? 17_040 : quantity(args, "carried");
  const balance = option(args, "balance") === undefined ? 0 : quantity(args, "balance");
  const one = hang({ rope: line0, length, ropes: number(args, "ropes", 1), carried, balance });
  const going = option(args, "speed") === undefined ? 15 : quantity(args, "speed");
  const retardation = number(args, "retardation", EMERGENCY_BRAKE);

  const rows: Array<readonly [string, string]> = [
    ["rope from the sheave", metres(one.length, 0)],
    ["the modulus it stretches to", `${places(pullModulus(one.rope), 0)} N/mm²`],
    ["how stiff that makes it", `${places(springRate(one), 1)} kN/m`],
    ["what hangs on it", force(staticPull(one))],
    ["the load stretches it", metres(stretchUnder(one, weightOf(one.carried + one.balance)), 3)],
    ["its own weight stretches it", metres(ownStretch(one), 3)],
    ["altogether", metres(wholeStretch(one), 3)],
    ["what swings on the end", `${places(bounceMass(one) / 1000, 2)} t`],
    ["the period it bounces at", seconds(bouncePeriod(one))],
    ["which is, a minute", places(bouncesAMinute(one), 1)],
    ["it runs on while the rope takes up", metres(slackRun(one, going), 1)],
    ["a stop adds, steadily", force(steadyRise(one, retardation))],
    ["and at worst", force(SUDDEN * steadyRise(one, retardation))],
    ["so the rope carries, rising", force(peakPull(one, retardation))],
    ["at a factor of", sayFactor(shockFactor(one, retardation))],
    ["which clears the floor", verdict(shockFactor(one, retardation) >= DEEPEST_FACTOR)],
    ["and carries, falling", force(leastPull(one, retardation))],
    ["it goes slack falling above", `${places(hardestDown(one), 2)} m/s²`],
    ["and loses the floor rising above", `${places(hardestUp(one, DEEPEST_FACTOR), 2)} m/s²`],
    ["one stop uses, of breaking", share(stopShare(one, retardation))],
    ["a snatch at that speed would be", force(snatchPull(one, going))],
    ["against a breaking load of", force(breakingLoad(one.rope) * one.ropes)],
  ];

  const out: string[] = [
    ...heading(describeSpring(one)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("the same rope, wound up the shaft"),
      ...table(
        [right("from the sheave"), right("stiffness"), right("swinging"), right("a bounce"), right("stopped at"), left("slack falling")],
        [1, 0.75, 0.5, 0.25, 0.05].map((at) => {
          const there = hang({ ...one, length: Math.max(1, one.length * at) });
          return [
            metres(there.length, 0),
            `${places(springRate(there), 0)} kN/m`,
            `${places(bounceMass(there) / 1000, 1)} t`,
            seconds(bouncePeriod(there)),
            sayFactor(shockFactor(there, retardation)),
            verdict(goesSlack(there, retardation)),
          ];
        }),
      ),
    );
  }

  return blocks(
    out,
    [
      line("a round strand rope keeps", share(LAID_MODULUS)),
      line("and a locked coil one", share(LOCKED_MODULUS)),
      line("of the rope's own mass swings", share(MOVING_THIRD)),
      line("a sudden load does", `${places(SUDDEN, 0)} times a gentle one`),
      line("the stop itself", describeShock(one, retardation)),
    ],
    wrapped(
      "A balance rope hangs from the conveyance rather than from the sheave, so the whole of it " +
        "goes where the conveyance goes and the whole of it has to be retarded with it. Only a " +
        "third of the winding rope does. That is why a balanced winder is hardest on its rope at " +
        "the top of the shaft, where the winding rope is nearly all wound up and the balance rope " +
        "is nearly all hanging, and an unbalanced one is hardest on it at the bottom.",
    ),
  );
}
