/**
 * `sheave power` — what the engine does, and what it is rated at.
 *
 * The two are not the same number. A winder's peak load lasts fifteen
 * seconds and its cycle lasts two minutes, so a motor rated at the peak
 * is three times the motor the duty needs — and one rated at the mean
 * will burn out, because heating goes as the square of the current and
 * the mean of a square is not the square of a mean.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import { constructionNamed, rope } from "../../rope/index.ts";
import { conveyance, skip } from "../../cage/index.ts";
import { profile } from "../../cycle/index.ts";
import {
  accelerationForce,
  atEnd,
  atStart,
  balanceWanted,
  describeDuty,
  duty,
  energyPerTonne,
  energyPerWind,
  motorFor,
  movingMass,
  outOfBalance,
  overloadRatio,
  peakPower,
  regenerated,
  regeneratedShare,
  rmsPower,
  ropeBalanced,
  ropeMetre,
  swing,
  windLasts,
} from "../../power/duty.ts";
import { energy, force, heading, kilograms, line, metres, perMetre, places, power, seconds, share, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["depth", "rope", "ropes", "payload", "tare", "balance", "radius", "inertia", "full", "accelerate", "rest", "sweep"];

/** Run it. */
export function powerCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const line0 = rope(
    option(args, "rope") === undefined ? 52 : quantity(args, "rope") * 1000,
    constructionNamed("6x36"),
    1960,
  );
  const depth = option(args, "depth") === undefined ? 942 : quantity(args, "depth");
  const payload = option(args, "payload") === undefined ? 12_000 : quantity(args, "payload");
  const loaded = option(args, "tare") === undefined ? skip(payload) : conveyance({ name: "the loaded one", kind: "skip", tare: quantity(args, "tare"), payload, decks: 1, width: 2.2, across: 1.8 });
  const empty = conveyance({ name: "the empty one", kind: "skip", tare: loaded.tare, payload: 0, decks: 1, width: 2.2, across: 1.8 });
  const how = profile({
    full: option(args, "full") === undefined ? 15 : quantity(args, "full"),
    accelerate: number(args, "accelerate", 1),
    rest: option(args, "rest") === undefined ? 25 : quantity(args, "rest"),
  });
  const bare = duty({
    rising: loaded,
    falling: empty,
    rope: line0,
    ropes: number(args, "ropes", 1),
    balance: number(args, "balance", 0),
    depth,
    radius: option(args, "radius") === undefined ? 2.1 : quantity(args, "radius"),
    inertia: option(args, "inertia") === undefined ? 30_000 : quantity(args, "inertia"),
  });
  const balanced = duty({ ...bare, balance: balanceWanted(bare) });

  const rows = (one: typeof bare): Array<readonly [string, string]> => [
    ["out-of-balance at the start", force(atStart(one))],
    ["and at the end", force(atEnd(one))],
    ["so it swings", force(swing(one))],
    ["everything that must be accelerated", kilograms(movingMass(one))],
    ["the force that takes", force(accelerationForce(one, how.accelerate))],
    ["peak power", power(peakPower(one, how))],
    ["r.m.s. power", power(rmsPower(one, how))],
    ["motor it wants", power(motorFor(one, how))],
    ["overload it must carry", places(overloadRatio(one, how), 2)],
    ["energy a wind", `${places(energyPerWind(one), 2)} kWh`],
    ["energy a tonne raised", energy(energyPerTonne(one))],
    ["given back on the brake", `${places(regenerated(one, how), 2)} kWh`],
    ["which is, of the wind", share(regeneratedShare(one, how))],
  ];

  const out: string[] = [
    ...heading(describeDuty(bare, how)),
    ...table(
      [left(""), right("no balance rope"), right("with one")],
      rows(bare).map((each, at) => [each[0], each[1], (rows(balanced)[at] as readonly [string, string])[1]]),
    ),
    "",
    line("the wind lasts", seconds(windLasts(bare, how))),
    line("the winding rope weighs", perMetre(ropeMetre(bare))),
    line("a matched balance rope would be", perMetre(balanceWanted(bare))),
    line("the one given is", perMetre(bare.balance)),
    line("which is a match", verdict(ropeBalanced(bare))),
  ];

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("the out-of-balance through the wind"),
      ...table(
        [right("to go"), right("no balance rope"), right("with one")],
        [1, 0.75, 0.5, 0.25, 0].map((at) => [
          metres(depth * at),
          force(outOfBalance(bare, depth * at)),
          force(outOfBalance(balanced, depth * at)),
        ]),
      ),
    );
  }

  return blocks(
    out,
    wrapped(
      "A shaft of nine hundred metres hangs eight tonnes of rope, and at the start of a wind all " +
        "of it is on the rising side and at the end all of it is on the falling side. The winder " +
        "therefore starts a wind lifting the payload and the rope, and finishes it being driven " +
        "by the rope — and the swing between the two is as large as the payload.",
    ),
  );
}
