import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { drawLineFor } from "../../catalog/draw.js";
import type { Draw } from "../../catalog/draw.js";
import { Magazine, shortfall, unusedStock } from "../../catalog/inventory.js";
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
 * A stand in does not shorten that list. The compiler will happily fire six
 * inch kamuros in place of six inch palms and the show will run, but the
 * palms are still not in the magazine, and a purchase order written off a
 * count that had substitutions folded into it is an order for the wrong
 * shells. So the counts here are what the script asked for, the stand ins are
 * listed underneath as what the crew would be doing about it, and the command
 * still fails.
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

    const bookPath = args.values.get("magazine");
    const magazine = outcome.inputs.workspace.magazine;
    if (bookPath !== undefined && magazine === undefined) {
      // The workspace has already said why, in the usual shape.
      env.err(formatBag(outcome.inputs.workspace.diagnostics));
      return EXIT_SHOW_PROBLEM;
    }
    const held = magazine ?? new Magazine();

    // What the script asked for, not what was drawn. A cue firing a stand in
    // still counts against the effect it was written for.
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

    if (bookPath === undefined) {
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
      for (const detail of standInLines(result.draw, line.effectId)) {
        env.err(detail);
      }
    }
    return EXIT_SHOW_PROBLEM;
  },
};

/** What stood in for one effect, as lines to sit under its shortfall. */
function standInLines(draw: Draw | undefined, effectId: string): string[] {
  if (draw === undefined) {
    return [];
  }
  const line = drawLineFor(draw, effectId);
  if (line === undefined) {
    return [];
  }
  const lines = line.standIns.map(
    (standIn) =>
      `  ${standIn.effectId} stands in for ${plural(standIn.shots, "shot")}, from lot ${standIn.lots.join(", ")}`,
  );
  if (line.uncovered > 0) {
    lines.push(
      `  nothing stands in for ${plural(line.uncovered, "shot")}, which keep what was written`,
    );
  }
  return lines;
}
