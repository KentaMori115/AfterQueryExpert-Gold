/**
 * `sheave conveyance` — the cage against the skip.
 *
 * A cage weighs six or eight tonnes empty and carries four, so two
 * thirds of the work the winder does is lifting the cage. A skip
 * carries nothing but coal and weighs a third of what it carries. That
 * is the trade, and every colliery that ever made it kept a second
 * shaft with cages in for the men.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import {
  A_MAN,
  A_MAN_WEIGHS,
  A_TUB,
  CAGE_TARE,
  SKIP_FILL,
  SKIP_TARE,
  conveyance,
  counterweight,
  counterweightFor,
  describeConveyance,
  emptyWeight,
  gross,
  loadedWeight,
  matched,
  menIn,
  menLimitedBy,
  outOfBalance,
  outOfBalanceWeight,
  payloadAllowed,
  skip,
  skipCarries,
  skipVolume,
  tubsIn,
  usefulFraction,
} from "../../cage/conveyance.ts";
import { force, heading, kilograms, line, metres, places, share, tonnes, verdict, wrapped } from "../../report/format.ts";
import { blocks, left, right, table } from "../../report/table.ts";

const KNOWN = ["kind", "tare", "payload", "decks", "width", "across", "bulk", "allowed", "compare"];

/** Run it. */
export function conveyanceCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const kind = option(args, "kind") ?? "cage";
  const payload = option(args, "payload") === undefined ? (kind === "skip" ? 12_000 : 4000) : quantity(args, "payload");
  const one =
    kind === "skip" && option(args, "tare") === undefined
      ? skip(payload)
      : conveyance({
          name: `the ${kind}`,
          kind: kind === "skip" ? "skip" : "cage",
          tare: option(args, "tare") === undefined ? payload * CAGE_TARE : quantity(args, "tare"),
          payload,
          decks: number(args, "decks", kind === "skip" ? 1 : 2),
          width: option(args, "width") === undefined ? 2.6 : quantity(args, "width"),
          across: option(args, "across") === undefined ? 1.5 : quantity(args, "across"),
        });

  const rows: Array<readonly [string, string]> = [
    ["what it is", one.kind],
    ["tare", tonnes(one.tare)],
    ["payload", tonnes(one.payload)],
    ["gross", tonnes(gross(one))],
    ["loaded, it hangs", force(loadedWeight(one))],
    ["empty", force(emptyWeight(one))],
    ["useful fraction", share(usefulFraction(one))],
    ["size across the shaft", metres(one.width, 2)],
    ["and the other way", metres(one.across, 2)],
    ["decks", places(one.decks, 0)],
  ];

  if (one.kind === "cage") {
    rows.push(
      ["men it carries", places(menIn(one), 0)],
      ["limited by the", menLimitedBy(one)],
      ["tubs it carries", places(tubsIn(one), 0)],
    );
  } else {
    const bulk = number(args, "bulk", 850);
    rows.push(
      ["volume it wants", `${places(skipVolume(one, bulk), 2)} m³`],
      ["what it carries on wet coal", kilograms(skipCarries(one, bulk + 100, skipVolume(one, bulk)))],
    );
  }

  const out: string[] = [
    ...heading(describeConveyance(one)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading("balanced against its partner"),
    ...table(
      [left(""), right("")],
      [
        ["against an empty one of the same tare", kilograms(outOfBalance(one, conveyance({ ...one, payload: 0 })))],
        ["which is", force(outOfBalanceWeight(one, conveyance({ ...one, payload: 0 })))],
        ["matched with it", verdict(matched(one, conveyance({ ...one, payload: 0 })))],
        ["a counterweight instead would be", tonnes(counterweightFor(one))],
        ["which weighs", force(loadedWeight(counterweight(one)))],
      ],
    ),
  ];

  const allowed = option(args, "allowed");
  if (allowed !== undefined) {
    out.push("", line(`on an allowance of ${force(quantity(args, "allowed"))} the payload may be`, kilograms(payloadAllowed(one, quantity(args, "allowed")))));
  }

  if (flag(args, "compare")) {
    out.push(
      "",
      ...heading("the same payload both ways"),
      ...table(
        [left(""), right("cage"), right("skip")],
        (() => {
          const asCage = conveyance({ name: "a cage", kind: "cage", tare: payload * CAGE_TARE, payload, decks: 2, width: 2.6, across: 1.5 });
          const asSkip = skip(payload);
          return [
            ["tare", tonnes(asCage.tare), tonnes(asSkip.tare)],
            ["gross", tonnes(gross(asCage)), tonnes(gross(asSkip))],
            ["useful fraction", share(usefulFraction(asCage)), share(usefulFraction(asSkip))],
            ["it hangs", force(loadedWeight(asCage)), force(loadedWeight(asSkip))],
            ["men it carries", places(menIn(asCage), 0), "none"],
          ];
        })(),
      ),
    );
  }

  return blocks(
    out,
    [
      line("a cage weighs, as a share of its payload", places(CAGE_TARE, 2)),
      line("and a skip", places(SKIP_TARE, 2)),
      line("a man is allowed", `${places(A_MAN, 2)} m² and weighs ${places(A_MAN_WEIGHS, 0)} kg`),
      line("a tub of coal weighs", kilograms(A_TUB)),
      line("and a skip is filled to", share(SKIP_FILL)),
    ],
    wrapped(
      "The floor usually wins on a cage, which surprises people: a cage rated at four tonnes of " +
        "coal carries forty men weighing three and a half, and it is the fifth of a square metre " +
        "each that stops it carrying more.",
    ),
  );
}
