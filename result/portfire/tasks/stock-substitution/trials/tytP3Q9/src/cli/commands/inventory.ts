import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { shortfall, unusedStock } from "../../catalog/inventory.js";
import type { StandIn } from "../../catalog/draw.js";
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
 * The counting is of what the script asked for, not of what the compiler drew.
 * A stand-in gets the show fired, and it changes nothing about the order: the
 * six inch palms are still missing, something else has been spent covering for
 * them, and this still fails. The stand-ins are printed under the line they
 * cover so a crew can see what the draw did with their stock, and that is all
 * they are here.
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
    const standIns = result.draw?.standIns ?? [];
    const magazine = outcome.inputs.options.magazine;

    const rows: string[][] = [];
    for (const [effectId, count] of [...needed.entries()].sort((a, b) =>
      compareIds(a[0], b[0]),
    )) {
      if (magazine === undefined) {
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
      for (const line of standIns.filter(
        (stand) => stand.effectId === effectId,
      )) {
        rows.push([`  ${describeStandIn(line)}`, "", "", ""]);
      }
    }
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

    if (magazine === undefined) {
      return outcomeCode(outcome);
    }

    if (args.switches.has("unused")) {
      // Stock a stand-in was drawn from counts as used, whatever the script
      // asked for, or the report would offer a crew a case that is already
      // spoken for.
      const touched = new Map(needed);
      for (const line of standIns) {
        touched.set(line.standInId, line.shots);
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

/** One stand-in as a crew reads it: how many cues, and out of which lots. */
function describeStandIn(line: StandIn): string {
  const lots = line.lots.length === 0 ? "" : ` from ${line.lots.join(", ")}`;
  return `${plural(line.shots, "cue")} fire ${line.standInId}${lots}`;
}
