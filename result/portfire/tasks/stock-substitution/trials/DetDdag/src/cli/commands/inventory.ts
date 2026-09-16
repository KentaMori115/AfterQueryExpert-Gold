import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { withoutLots } from "../../catalog/draw.js";
import type { StandIn } from "../../catalog/draw.js";
import { Magazine, shortfall, unusedStock } from "../../catalog/inventory.js";
import { countBy } from "../../core/collect.js";
import { formatBag } from "../../core/diagnostic.js";
import { compareIds } from "../../core/ids.js";
import { renderTable } from "../../core/text.js";
import type { Column } from "../../core/text.js";

/**
 * What the show needs against what is in the store.
 *
 * The answer a crew actually wants is the order list, and the order list is
 * the shortfall rather than the shot list. Printing the shot list alone means
 * somebody sits with two spreadsheets and subtracts, which is the step that
 * goes wrong at eleven at night the week before a show.
 *
 * The draw does not change that arithmetic. A cue covered by a stand-in still
 * counts against the effect the script asked for, because the order list is
 * what has to be bought to fire the show as written, and this command still
 * fails on a shortfall a stand-in covered. The stand-ins are printed under the
 * line they cover so a crew can see what a compile has already decided.
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

    const bookPath = inputs.book;
    if (bookPath !== undefined && inputs.magazine === undefined) {
      // The book would not parse, and runShow has already said why. Counting
      // against a magazine that failed to load would read as an order list for
      // the whole show.
      return EXIT_SHOW_PROBLEM;
    }

    // What the script asked for, not what went in the tube. A stand-in covers
    // a cue; it does not fill an order.
    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );
    const magazine =
      inputs.magazine === undefined
        ? new Magazine()
        : withoutLots(inputs.magazine, inputs.pull);
    const standIns = result.draw?.standIns ?? [];

    const columns: Column[] = [
      { header: "effect" },
      { header: "needed", align: "right" },
      { header: "on hand", align: "right" },
      { header: "short", align: "right" },
    ];
    if (standIns.length > 0) {
      columns.push({ header: "lots" });
    }

    const rows: string[][] = [];
    for (const [effectId, count] of [...needed.entries()].sort((a, b) =>
      compareIds(a[0], b[0]),
    )) {
      if (bookPath === undefined) {
        // With no book there is no stock figure, so there is no shortfall
        // either. Printing a shortfall equal to the whole shot list would
        // read as an order list, which is exactly the wrong thing to hand
        // somebody.
        rows.push([effectId, String(count), "", ""]);
        continue;
      }
      const onHand = magazine.onHand(effectId);
      const short = Math.max(0, count - onHand);
      rows.push([
        effectId,
        String(count),
        String(onHand),
        short === 0 ? "" : String(short),
      ]);
      for (const stood of standIns.filter(
        (entry) => entry.effectId === effectId,
      )) {
        rows.push(standInRow(stood));
      }
    }
    env.out(renderTable(columns, rows));

    if (bookPath === undefined) {
      return outcomeCode(outcome);
    }

    if (args.switches.has("unused")) {
      // Stock a stand-in came out of is stock this show uses, whatever the
      // script says, so it does not belong on the list of what is spare.
      const touched = new Map(needed);
      for (const stood of standIns) {
        touched.set(stood.substituteId, stood.shots);
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
    }
    return EXIT_SHOW_PROBLEM;
  },
};

/** The stand-in line, indented so it reads as part of the line above it. */
function standInRow(stood: StandIn): string[] {
  return [
    `  stood in by ${stood.substituteId}`,
    String(stood.shots),
    "",
    "",
    stood.lots.join(", "),
  ];
}
