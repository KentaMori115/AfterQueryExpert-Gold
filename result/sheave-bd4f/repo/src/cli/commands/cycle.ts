/**
 * `sheave cycle` — the wind, and the standing time that beats it.
 *
 * The thing that surprises people is how little of a wind is spent at
 * full speed in a shallow shaft. At six hundred metres and fifteen
 * metres a second, a third of the wind is acceleration and a third is
 * deceleration — and in a shaft of two hundred metres the cage never
 * reaches full speed at all, so raising the winder's top speed buys
 * nothing whatever.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  MEN_ACCELERATION,
  MEN_SPEED,
  accelerating,
  atFullShare,
  cycleTime,
  decelerating,
  describeWind,
  forMen,
  menAnHour,
  movingShare,
  needsToReachFull,
  profile,
  reachesFull,
  shiftDown,
  speedFor,
  tonnesADay,
  tonnesAnHour,
  topSpeed,
  windTime,
  windsAnHour,
  worthOfASecond,
  worthOfSpeed,
} from "../../cycle/kinematics.ts";
import { heading, line, metres, minutes, perDay, perHour, places, seconds, share, speed, verdict, wrapped } from "../../report/format.ts";
import { barOf, blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["depth", "full", "accelerate", "decelerate", "creep", "creepfor", "rest", "payload", "hours", "cage", "men", "want", "sweep", "bars"];

/** Run it. */
export function cycleCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = profile({
    full: option(args, "full") === undefined ? 15 : quantity(args, "full"),
    accelerate: number(args, "accelerate", 1),
    decelerate: number(args, "decelerate", 1.1),
    creep: option(args, "creep") === undefined ? 0.5 : quantity(args, "creep"),
    creepFor: option(args, "creepfor") === undefined ? 6 : quantity(args, "creepfor"),
    rest: option(args, "rest") === undefined ? 25 : quantity(args, "rest"),
  });
  const depth = option(args, "depth") === undefined ? 942 : quantity(args, "depth");
  const payload = option(args, "payload") === undefined ? 12_000 : quantity(args, "payload");
  const hours = number(args, "hours", 16);
  const cage = number(args, "cage", 39);

  const rows: Array<readonly [string, string]> = [
    ["the wind", metres(depth)],
    ["full speed", speed(one.full)],
    ["it reaches it", verdict(reachesFull(one, depth))],
    ["the least wind that does", metres(needsToReachFull(one), 1)],
    ["fastest this wind gets", speed(topSpeed(one, depth))],
    ["getting up to speed takes", metres(accelerating(one), 1)],
    ["and getting down", metres(decelerating(one), 1)],
    ["the wind lasts", seconds(windTime(one, depth))],
    ["the cycle lasts", seconds(cycleTime(one, depth))],
    ["of which it is moving", share(movingShare(one, depth))],
    ["and at full speed", share(atFullShare(one, depth))],
    ["winds an hour", places(windsAnHour(one, depth), 2)],
    ["tonnes an hour", perHour(tonnesAnHour(one, depth, payload))],
    ["tonnes a day", perDay(tonnesADay(one, depth, payload, hours))],
  ];

  const bar = (value: number): string => (flag(args, "bars") ? ` ${barOf(value, 20)}` : "");

  const out: string[] = [
    ...heading(describeWind(one, depth)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading("where the cycle goes"),
    ...table(
      [left(""), right(""), left("")],
      [
        ["moving", seconds(windTime(one, depth)), bar(movingShare(one, depth))],
        ["standing", seconds(one.rest), bar(1 - movingShare(one, depth))],
        ["at full speed", seconds(atFullShare(one, depth) * windTime(one, depth)), bar(atFullShare(one, depth))],
      ],
    ),
    "",
    ...heading("what is worth buying"),
    ...table(
      [left(""), right("")],
      [
        ["a second off the standing time", perHour(worthOfASecond(one, depth, payload))],
        ["a metre a second on the winder", perHour(worthOfSpeed(one, depth, payload))],
        ["which is the better buy", worthOfASecond(one, depth, payload) >= worthOfSpeed(one, depth, payload) ? "the pit top" : "the engine house"],
      ],
    ),
    "",
    ...heading("winding men, which is a slower cycle"),
    ...table(
      [left(""), right("")],
      [
        ["men may be wound at", speed(MEN_SPEED)],
        ["and accelerated at", `${places(MEN_ACCELERATION, 2)} m/s²`],
        ["so the man cycle lasts", seconds(cycleTime(forMen(one), depth))],
        ["men an hour", places(menAnHour(one, depth, cage), 0)],
        ["a shift of 400 takes", minutes(shiftDown(one, depth, cage, number(args, "men", 400)))],
      ],
    ),
  ];

  const want = option(args, "want");
  if (want !== undefined) {
    const asked = Number(want);
    out.push("", line(`for ${perHour(asked)} the winder wants`, speed(speedFor(one, depth, asked, payload))));
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what the depth does to all of it"),
      ...table(
        [right("depth"), right("cycle"), right("at full"), right("t/h"), right("a second"), right("a m/s")],
        [200, 400, 600, 942, 1400, 2000].map((each) => [
          metres(each),
          seconds(cycleTime(one, each)),
          share(atFullShare(one, each)),
          perHour(tonnesAnHour(one, each, payload)),
          perHour(worthOfASecond(one, each, payload)),
          perHour(worthOfSpeed(one, each, payload)),
        ]),
      ),
    );
  }

  return blocks(
    out,
    wrapped(
      "Winding faster is expensive and mostly impossible; decking faster costs nothing but " +
        "arrangement. In a shallow shaft a second saved at the pit top is worth more than a metre " +
        "a second on the winder, and in a very shallow one the metre a second is worth exactly " +
        "nothing because the cage never gets there.",
    ),
  );
}
