/**
 * `sheave decking` — the standing time, and the deck that buys it back.
 *
 * The one figure in a winding cycle that comes off a landing rather
 * than out of a machine. A cage stands while every deck of it is
 * changed and stands again between decks, so a deck is bought in
 * payload and paid for in seconds, and the deck goes on winning until
 * the rope will not carry another one. At that point it loses twice,
 * because the cage it is built into is heavier for it.
 *
 * The sheet is printed a row a deck rather than as one answer, because
 * an engineer deciding whether to put a third deck in a cage is not
 * asking which number is largest. He is asking how much he loses by
 * being wrong, and that is the row above and the row below.
 */

import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, quantity } from "../args.ts";
import { A_TUB, type Conveyance, conveyance, gross, kindNamed, menIn, menLimitedBy, usefulFraction } from "../../cage/index.ts";
import {
  MOST_DECKS,
  raisesADay,
  standingADay,
  standingShare,
  bestDecks,
  deckChange,
  deckMove,
  deckSheet,
  deckedCage,
  decking,
  decksAllowed,
  describeDecking,
  raises,
  redecking,
  stand,
  standAt,
  withDecking,
  worthOfADeck,
} from "../../cycle/decking.ts";
import { MEN_SPEED, cycleTime, forMen, profile, reachesFull, windTime, windsAnHour } from "../../cycle/kinematics.ts";
import { force, heading, metres, perDay, perHour, places, seconds, share, speed, tonnes, verdict, wrapped } from "../../report/format.ts";
import { barOf, blocks, left, right, table } from "../../report/table.ts";

const KNOWN = [
  "depth",
  "decks",
  "allowed",
  "pertub",
  "tubsadeck",
  "pitch",
  "settle",
  "discharge",
  "tub",
  "creep",
  "creepfor",
  "full",
  "accelerate",
  "decelerate",
  "kind",
  "hours",
  "most",
  "men",
  "compare",
  "sweep",
  "bars",
];

/** The arrangement the options ask for. */
function asked(args: Args) {
  return decking({
    perTub: option(args, "pertub") === undefined ? undefined : quantity(args, "pertub"),
    tubsADeck: option(args, "tubsadeck") === undefined ? undefined : number(args, "tubsadeck"),
    pitch: option(args, "pitch") === undefined ? undefined : quantity(args, "pitch"),
    settle: option(args, "settle") === undefined ? undefined : quantity(args, "settle"),
    discharge: option(args, "discharge") === undefined ? undefined : quantity(args, "discharge"),
  });
}

/** Run it. */
export function deckingCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = asked(args);
  const how = profile({
    full: option(args, "full") === undefined ? 15 : quantity(args, "full"),
    accelerate: number(args, "accelerate", 1),
    decelerate: number(args, "decelerate", 1.1),
    creep: option(args, "creep") === undefined ? 0.5 : quantity(args, "creep"),
    creepFor: option(args, "creepfor") === undefined ? 6 : quantity(args, "creepfor"),
  });
  const depth = option(args, "depth") === undefined ? 942 : quantity(args, "depth");
  const decks = number(args, "decks", 2);
  const allowed = option(args, "allowed") === undefined ? 220 : quantity(args, "allowed");
  const aTub = option(args, "tub") === undefined ? A_TUB : quantity(args, "tub");
  const most = number(args, "most", 4);
  const hours = number(args, "hours", 16);
  const kind = kindNamed(option(args, "kind") ?? "cage");

  const loaded: Conveyance =
    kind === "cage"
      ? deckedCage(one, decks, allowed, aTub)
      : conveyance({ name: `the loaded ${kind}`, kind, tare: 5040, payload: 12_000, decks: 1, width: 2.2, across: 1.8 });
  const empty = conveyance({ ...loaded, name: `the empty ${kind}`, payload: 0 });
  const working = withDecking(how, one, loaded, empty);
  const standing = standingShare(how, one, loaded, empty, depth);

  const rows: Array<readonly [string, string]> = [
    ["the wind", metres(depth)],
    ["the rope allows to hang", force(allowed)],
    ["what the cage carries", tonnes(loaded.payload)],
    ["and weighs loaded", tonnes(gross(loaded))],
    ["useful fraction", share(usefulFraction(loaded))],
    ["a deck takes", seconds(deckChange(one))],
    ["a move between decks", seconds(deckMove(one, how.creep))],
    ["the moves come to", seconds(redecking(one, loaded.decks, how.creep))],
    ["so the rising one stands", seconds(standAt(one, loaded, how.creep))],
    ["and the falling one", seconds(standAt(one, empty, how.creep))],
    ["the winder stands", seconds(stand(one, loaded, empty, how.creep))],
    ["the wind lasts", seconds(windTime(how, depth))],
    ["it reaches full speed", verdict(reachesFull(how, depth))],
    ["the cycle lasts", seconds(cycleTime(working, depth))],
    ["of which it is standing", share(standing)],
    ["winds an hour", places(windsAnHour(working, depth), 2)],
    ["tonnes an hour", perHour(raises(how, one, decks, depth, allowed, aTub))],
    ["tonnes a day", perDay(raisesADay(how, one, decks, depth, allowed, hours, aTub))],
    ["hours a day standing", places(standingADay(how, one, loaded, empty, depth, hours), 2)],
  ];

  const bar = (value: number): string => (flag(args, "bars") ? ` ${barOf(value, 20)}` : "");

  const out: string[] = [
    ...heading(describeDecking(one, loaded, how.creep)),
    ...table([left(""), right("")], rows.map((each) => [each[0], each[1]])),
    "",
    ...heading("where the cycle goes"),
    ...table(
      [left(""), right(""), left("")],
      [
        ["winding", seconds(windTime(how, depth)), bar(1 - standing)],
        ["standing", seconds(working.rest), bar(standing)],
      ],
    ),
  ];

  if (kind === "cage") {
    out.push(
      "",
      ...heading("what another deck is worth"),
      ...table(
        [left(""), right("")],
        [
          ["the rope carries the tubs of", places(decksAllowed(one, allowed, aTub), 0)],
          ["the best number of decks here", places(bestDecks(how, one, depth, allowed, most, aTub), 0)],
          [
            "one more than this cage has",
            decks < MOST_DECKS ? perHour(worthOfADeck(how, one, decks, depth, allowed, aTub)) : "no more will go in",
          ],
        ],
      ),
    );
  }

  if (kind === "cage") {
    const riding = forMen(withDecking(how, one, loaded, empty));
    const aWind = menIn(loaded);
    const men = number(args, "men", 400);
    const winds = aWind > 0 ? Math.ceil(men / aWind) : 0;
    out.push(
      "",
      ...heading("the same cage, winding men"),
      ...table(
        [left(""), right("")],
        [
          ["men a wind", places(aWind, 0)],
          ["what limits them", menLimitedBy(loaded)],
          ["men are wound at", speed(MEN_SPEED)],
          ["so their cycle lasts", seconds(cycleTime(riding, depth))],
          [`${places(men, 0)} men take`, winds > 0 ? seconds(winds * cycleTime(riding, depth)) : "no man rides in that"],
          ["and that is off the coal", perDay(winds > 0 ? (raises(how, one, decks, depth, allowed, aTub) * winds * cycleTime(riding, depth)) / 3600 : 0)],
        ],
      ),
    );
  }

  if (flag(args, "compare")) {
    out.push(
      "",
      ...heading("deck against deck"),
      ...table(
        [right("decks"), right("payload"), right("standing"), right("cycle"), right("t/h")],
        deckSheet(how, one, depth, allowed, most, aTub).map((each) => [
          places(each.decks, 0),
          tonnes(each.payload),
          seconds(each.stand),
          seconds(each.cycle),
          perHour(each.raises),
        ]),
      ),
    );
  }

  if (flag(args, "sweep")) {
    out.push(
      "",
      ...heading("what the depth does to the answer"),
      ...table(
        [right("depth"), right("best"), right("t/h"), right("standing")],
        [200, 400, 600, 942, 1400, 2000].map((each) => {
          const best = bestDecks(how, one, each, allowed, most, aTub);
          const cage = deckedCage(one, best, allowed, aTub);
          const pair = withDecking(how, one, cage, conveyance({ ...cage, payload: 0 }));
          return [
            metres(each),
            places(best, 0),
            perHour(raises(how, one, best, each, allowed, aTub)),
            share(pair.rest / cycleTime(pair, each)),
          ];
        }),
      ),
    );
  }

  out.push(
    "",
    ...heading("what the standing time costs"),
    ...table(
      [left(""), right("")],
      [
        ["hours a day standing", places(standingADay(how, one, loaded, empty, depth, hours), 2)],
        ["what it raises in a day", perDay(raisesADay(how, one, decks, depth, allowed, hours, aTub))],
        ["and standing none of it", perDay((3600 / windTime(how, depth)) * (loaded.payload / 1000) * hours)],
      ],
    ),
  );

  return blocks(
    out,
    wrapped(
      "Decking is the cheapest thing on a winding installation to change and the last thing " +
        "anybody changes. A deck is steel and a tippler is money, but a second off the time a tub " +
        "takes comes off every wind of every shift for the life of the pit. At " +
        `${speed(how.full)} a wind of ${metres(depth)} stands ${share(standing)} of its cycle, and ` +
        `the rope on it carries the tubs of ${places(decksAllowed(one, allowed, aTub), 0)} decks.`,
    ),
  );
}
