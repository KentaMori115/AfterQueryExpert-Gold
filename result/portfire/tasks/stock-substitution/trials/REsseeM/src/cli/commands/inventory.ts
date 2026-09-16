import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import type { Magazine } from "../../catalog/inventory.js";
import { shortfall, unusedStock } from "../../catalog/inventory.js";
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
 *
 * The counting is over what the script asked for rather than over what the
 * draw ended up firing. A cue covered by a stand-in is still a shell the show
 * was designed around and still a line on the order list, so a substitution
 * must not make a shortfall disappear from the page that exists to show it.
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

    if (inputs.bookNamed && inputs.magazine === undefined) {
      // The book was named and would not load. Its diagnostics have already
      // been printed, and counting against an empty store would read as an
      // order list for the whole show.
      return EXIT_SHOW_PROBLEM;
    }

    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );

    const held = heldAfterPull(inputs.magazine, inputs.pull);

    const rows = [...needed.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([effectId, count]) => {
        if (held === undefined) {
          // With no book there is no stock figure, so there is no shortfall
          // either. Printing a shortfall equal to the whole shot list would
          // read as an order list, which is exactly the wrong thing to hand
          // somebody.
          return [effectId, String(count), "", ""];
        }
        const onHand = held.onHand(effectId);
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

    if (held === undefined) {
      return outcomeCode(outcome);
    }

    if (args.switches.has("unused")) {
      const spare = unusedStock(needed, held);
      env.out("");
      env.out(
        spare.length === 0
          ? "every line in the magazine is used by this show"
          : `not used by this show: ${spare.join(", ")}`,
      );
    }

    const missing = shortfall(needed, held);
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

/**
 * The stock a crew can actually reach for, which is the book less anything set
 * aside. The copy matters: quarantining the book itself would leave the
 * caller's magazine short for whatever ran next.
 */
function heldAfterPull(
  magazine: Magazine | undefined,
  pull: readonly string[],
): Magazine | undefined {
  if (magazine === undefined) {
    return undefined;
  }
  if (pull.length === 0) {
    return magazine;
  }
  const held = magazine.copy();
  for (const lotNumber of pull) {
    held.quarantine(lotNumber);
  }
  return held;
}
