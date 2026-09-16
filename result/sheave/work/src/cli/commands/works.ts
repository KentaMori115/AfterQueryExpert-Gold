/**
 * `sheave works` — the chain the winder is one link of.
 *
 * A winder that raises six hundred tonnes an hour is worth nothing if
 * the pit bottom fills two hundred, and worth nothing again if the
 * screens above take four hundred. A colliery's output is set by
 * whichever link is shortest, and it is almost never the one anybody
 * has spent money on — because the money went to the link that was
 * shortest last time.
 */

import { readFileSync } from "node:fs";
import { WindingError } from "../../errors.ts";
import type { Args } from "../args.ts";
import { flag, number, onlyKnown, option, word } from "../args.ts";
import { parseWinder } from "../../winder/parse.ts";
import {
  aDay as linkADay,
  afterManWinding,
  arrivalsAnHour,
  asLink,
  betweenArrivals,
  bunkerFor,
  chainOutput,
  closeBehind,
  describeChain,
  despatched,
  link,
  manWindingCosts,
  manWindingHours,
  shiftBunker,
  shortest,
  spare,
  stockingDays,
  wagonsADay,
  wastedLengthening,
  wholeShifts,
  worthOfLengthening,
} from "../../works/output.ts";
import { menIn } from "../../cage/index.ts";
import { heading, line, perDay, perHour, places, seconds, share, tonnes, wrapped } from "../../report/format.ts";
import { blocks, left, right, sortedByNumber, table } from "../../report/table.ts";

const KNOWN = ["chain", "men", "ground", "by", "wagon"];

/** Run it. */
export function worksCommand(args: Args): string[] {
  onlyKnown(args, KNOWN);
  const one = parseWinder(readFileSync(word(args, 0, "a winder file"), "utf8"));
  const given = option(args, "chain");
  const chain = [
    asLink(one),
    ...(given ?? "faces:420:18,pit bottom:500:20,screens:380:20,rapid loader:900:8").split(",").map((each) => {
      const [name, capacity, hours] = each.split(":");
      if (name === undefined || capacity === undefined) {
        throw new WindingError(`a link is written screens:380:20, not ${each}`, "chain");
      }
      return link(name, Number(capacity), hours === undefined ? 16 : Number(hours));
    }),
  ];
  const men = number(args, "men", 400);
  const cage = one.rising.kind === "cage" ? menIn(one.rising) : 39;
  const by = number(args, "by", 0.2);

  const found = spare(chain);
  const out: string[] = [
    ...heading(describeChain(chain)),
    ...table(
      [left("link"), right("t/h"), right("hours"), right("t/d"), right("spare")],
      sortedByNumber(
        chain.map((each) => [
          each.name,
          perHour(each.capacity),
          places(each.hours, 0),
          perDay(linkADay(each)),
          share(found[each.name] ?? 0),
        ]),
        3,
      ),
    ),
    "",
    ...heading("what lengthening the shortest is worth"),
    ...table(
      [left(""), right("")],
      [
        ["the shortest link is", shortest(chain).name],
        [`lengthening it by ${share(by)} gives`, perDay(worthOfLengthening(chain, by))],
        ["of which is wasted", share(wastedLengthening(chain, by))],
        ["links within a seventh of being shortest", places(closeBehind(chain), 0)],
      ],
    ),
    "",
    ...heading("the bank and the sidings"),
    ...table(
      [left(""), right("")],
      [
        ["arrivals an hour", places(arrivalsAnHour(one), 2)],
        ["seconds between them", seconds(betweenArrivals(one))],
        ["bunker for the cycle", tonnes(bunkerFor(one) * 1000)],
        ["bunker for a shift change", tonnes(shiftBunker(one) * 1000)],
        ["wagons a day", places(wagonsADay(chainOutput(chain), number(args, "wagon", 21)), 0)],
        ["despatched, in whole wagons", perDay(despatched(chainOutput(chain), number(args, "wagon", 21)))],
      ],
    ),
    "",
    ...heading("what winding the men costs"),
    ...table(
      [left(""), right("")],
      [
        ["men to be wound", places(men, 0)],
        ["a cage takes", places(cage, 0)],
        ["hours it takes out of the day", places(manWindingHours(one, men, cage), 2)],
        ["coal that costs", perDay(manWindingCosts(one, men, cage))],
        ["leaving", perDay(afterManWinding(one, men, cage))],
      ],
    ),
  ];

  const ground = option(args, "ground");
  if (ground !== undefined) {
    out.push(
      "",
      line("a stocking ground of " + tonnes(Number(ground) * 1000) + " lasts", `${places(stockingDays(Number(ground), chainOutput(chain)), 1)} days`),
      line("and a week's output takes", `${places(wholeShifts(chainOutput(chain) * 7, one), 0)} shifts`),
    );
  }

  if (flag(args, "chain")) {
    out.push("", line("the chain as given", chain.map((each) => each.name).join(", ")));
  }

  return blocks(
    out,
    wrapped(
      "Lengthening the shortest link is worth nothing beyond the point where the second shortest " +
        "becomes the shortest, which is the fact this command exists to make obvious and the one " +
        "every capital scheme that ever overran was written without.",
    ),
  );
}
