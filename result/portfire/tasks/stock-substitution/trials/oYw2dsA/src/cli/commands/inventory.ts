import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { standInsFor } from "../../catalog/draw.js";
import {
  Magazine,
  shortfall,
  unusedStock,
  withoutLots,
} from "../../catalog/inventory.js";
import { countBy } from "../../core/collect.js";
import { formatBag } from "../../core/diagnostic.js";
import { compareIds } from "../../core/ids.js";
import { plural, renderTable } from "../../core/text.js";

/**
 * What the show needs against what is in the store.
 *
 * The answer a crew actually wants is the order list, and the order list is
 * the shortfall rather than the shot list. Printing the shot list alone means
 * somebody sits with two spreadsheets and subtracts, which is the step that
 * goes wrong at eleven at night the week before a show.
 *
 * Everything here counts what the script asked for, not what the compile drew.
 * A stand in keeps the show firing on the night and buys nothing on the order
 * form: the six inch palms are still missing, somebody still has to decide
 * whether to buy them, and the run still fails so that decision is made rather
 * than discovered. The stand ins are printed under the line they cover, with
 * the lots they came out of, because that is the paperwork.
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

    const bookPath = args.values.get("magazine");
    const book = inputs.options.magazine;
    if (bookPath !== undefined && book === undefined) {
      // The book would not parse. Reading it said why, and counting against
      // half a book would read as a shortfall the crew does not have.
      return EXIT_SHOW_PROBLEM;
    }
    const magazine =
      book === undefined
        ? new Magazine()
        : withoutLots(book, inputs.options.pull ?? []);
    const draw = result.draw;

    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
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

    if (args.switches.has("unused")) {
      // A line the show only reaches for as a stand in is used, whatever the
      // script says, so it does not belong on a list of spare stock.
      const touched = new Map(needed);
      for (const line of draw?.standIns ?? []) {
        touched.set(line.effectId, touched.get(line.effectId) ?? 0);
      }
      const spare = unusedStock(touched, magazine);
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
      for (const stand of draw === undefined
        ? []
        : standInsFor(draw, line.effectId)) {
        env.err(
          `  ${stand.effectId} stands in for ${plural(stand.shots, "shot")}, from ${stand.lots.length === 1 ? "lot" : "lots"} ${stand.lots.join(", ")}`,
        );
      }
    }
    return EXIT_SHOW_PROBLEM;
  },
};
