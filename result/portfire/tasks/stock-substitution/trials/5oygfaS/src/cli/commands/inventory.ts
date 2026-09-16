import { SHOW_FLAGS, lotNumbers, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { describeStandIn } from "../../catalog/draw.js";
import {
  shortfall,
  unusedStock,
  withoutLots,
} from "../../catalog/inventory.js";
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
 * The counts are of what the script asked for, even where the compiler has
 * already covered a cue with something else. A stand-in is a decision to fire
 * a different shell, not a shell arriving, so it settles nothing here and this
 * command still fails. What the stand-ins do earn is a line under the shortfall
 * they cover, because the crew has to know which cues are affected and which
 * lots went into them.
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
    const { result } = outcome;
    if (result.diagnostics.hasErrors()) {
      env.err(formatBag(result.diagnostics));
    }

    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );

    const book = outcome.inputs.workspace.magazine;
    if (book === undefined) {
      const rows = [...needed.entries()]
        .sort((a, b) => compareIds(a[0], b[0]))
        // With no book there is no stock figure, so there is no shortfall
        // either. Printing a shortfall equal to the whole shot list would read
        // as an order list, which is exactly the wrong thing to hand somebody.
        .map(([effectId, count]) => [effectId, String(count), "", ""]);
      env.out(renderTable(COLUMNS, rows));
      return outcomeCode(outcome);
    }

    // The pulled lots are not stock this show can use, so they are not on hand
    // as far as it is concerned.
    const magazine = withoutLots(book, lotNumbers(args.values.get("pull")));
    const rows = [...needed.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([effectId, count]) => {
        const onHand = magazine.onHand(effectId);
        const short = Math.max(0, count - onHand);
        return [
          effectId,
          String(count),
          String(onHand),
          short === 0 ? "" : String(short),
        ];
      });
    env.out(renderTable(COLUMNS, rows));

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
      for (const standIn of result.draw?.standIns ?? []) {
        if (standIn.effectId === line.effectId) {
          env.err(`  ${describeStandIn(standIn)}`);
        }
      }
    }
    return EXIT_SHOW_PROBLEM;
  },
};

const COLUMNS = [
  { header: "effect" },
  { header: "needed", align: "right" as const },
  { header: "on hand", align: "right" as const },
  { header: "short", align: "right" as const },
];
