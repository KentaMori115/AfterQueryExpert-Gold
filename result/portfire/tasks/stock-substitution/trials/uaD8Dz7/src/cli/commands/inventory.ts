import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { setAside } from "../../catalog/draw.js";
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

    // What the show consumes is what it drew, not what it asked for. A cue the
    // magazine covered with a stand-in is an order for the stand-in, and a cue
    // nothing covered still counts against the shell that was written, which is
    // exactly the line the crew has to buy in.
    const needed = countBy(result.schedule.events, (event) => event.effectId);

    const bookPath = args.values.get("magazine");
    if (bookPath !== undefined && inputs.magazine === undefined) {
      // The book was named and would not load. The reason is already printed.
      return EXIT_SHOW_PROBLEM;
    }
    const magazine =
      inputs.magazine === undefined
        ? new Magazine()
        : setAside(inputs.magazine, inputs.pull);

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

    if (inputs.pull.length > 0) {
      env.out("");
      env.out(`set aside: ${inputs.pull.join(", ")}`);
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
