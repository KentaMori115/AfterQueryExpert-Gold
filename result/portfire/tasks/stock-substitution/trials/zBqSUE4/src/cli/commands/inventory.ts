import { SHOW_FLAGS, outcomeCode, pullFromArgs, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { Magazine, shortfall, unusedStock } from "../../catalog/inventory.js";
import { countBy } from "../../core/collect.js";
import { formatBag } from "../../core/diagnostic.js";
import { compareIds } from "../../core/ids.js";
import { renderTable } from "../../core/text.js";

/**
 * What the show needs against what is in the store.
 *
 * The answer a crew actually wants is the order list, and the order list is
 * the shortfall rather than the shot list. Printing the shot list alone means
 * somebody sits with two spreadsheets and subtracts, which is the step that
 * goes wrong at eleven at night the week before a show.
 */
export const inventoryCommand: Command = {
  name: "inventory",
  summary: "count what a show consumes against what is in the magazine",
  usage: "inventory <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "unused",
      kind: "switch",
      help: "also list stock the show never uses",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const { inputs, result } = outcome;
    if (result.diagnostics.hasErrors()) {
      env.err(formatBag(result.diagnostics));
    }

    // The counts are of what will actually leave the magazine, so a cue that
    // has been given a stand-in counts against the stand-in. Counting the
    // design instead would hand somebody an order list for shells the show is
    // no longer going to fire.
    const needed = countBy(result.schedule.events, (event) => event.effectId);

    const bookPath = args.values.get("magazine");
    if (bookPath !== undefined && inputs.magazine === undefined) {
      // The book would not parse, and runShow has already said why.
      return EXIT_SHOW_PROBLEM;
    }
    // A lot set aside is not stock the show can have, so the on hand figures
    // are of the shelf the draw actually worked from rather than of the book.
    const pulled = new Set(pullFromArgs(args));
    const magazine =
      inputs.magazine === undefined
        ? new Magazine()
        : Magazine.from(
            inputs.magazine
              .stock()
              .flatMap((line) => line.lots)
              .filter((lot) => !pulled.has(lot.lotNumber)),
          );

    const rows = [...needed.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([effectId, count]) => {
        if (bookPath === undefined) {
          // With no book there is no stock figure, so there is no shortfall
          // either. Printing a shortfall equal to the whole shot list would
          // read as an order list, which is exactly the wrong thing to hand
          // somebody.
          return [effectId, String(count), "", ""];
        }
        const onHand = magazine.onHand(effectId);
        const short = Math.max(0, count - onHand);
        return [
          effectId,
          String(count),
          String(onHand),
          short === 0 ? "" : String(short),
        ];
      });
    env.out(
      renderTable(
        [
          { header: "effect" },
          { header: "needed", align: "right" },
          { header: "on hand", align: "right" },
          { header: "short", align: "right" },
        ],
        rows,
      ),
    );

    if (bookPath === undefined) {
      return outcomeCode(outcome);
    }

    const swaps = result.draw?.substitutions ?? [];
    if (swaps.length > 0) {
      env.out("");
      for (const swap of swaps) {
        env.out(
          `${swap.wanted} short ${swap.count}, drawn as ${swap.used} from ${swap.lots.join(", ")}`,
        );
      }
    }

    if (args.switches.has("unused")) {
      const spare = unusedStock(needed, magazine);
      env.out("");
      env.out(
        spare.length === 0
          ? "every line in the magazine is used by this show"
          : `not used by this show: ${spare.join(", ")}`,
      );
    }

    const missing = shortfall(needed, magazine);
    env.out("");
    if (missing.length === 0) {
      env.out("everything on the shot list is in stock");
      return outcomeCode(outcome);
    }
    for (const line of missing) {
      env.err(`short ${line.short} of ${line.effectId}`);
    }
    return EXIT_SHOW_PROBLEM;
  },
};
