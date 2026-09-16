import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import type { StandIn } from "../../catalog/draw.js";
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
 * The counts are of what the script asked for, not of what the draw ended up
 * loading. A stand-in is how a show gets fired on the day; it is not a reason
 * to stop ordering the shell the design wants, and a shortfall that quietly
 * vanished because something else covered it is the one way this report could
 * cost somebody a case of shells.
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

    // What the script asked for, which for a covered cue is not what it fires.
    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );
    const magazine = outcome.inputs.workspace.magazine;
    const hasBook = magazine !== undefined;
    const book = magazine ?? new Magazine();

    const rows = [...needed.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([effectId, count]) => {
        if (!hasBook) {
          // With no book there is no stock figure, so there is no shortfall
          // either. Printing a shortfall equal to the whole shot list would
          // read as an order list, which is exactly the wrong thing to hand
          // somebody.
          return [effectId, String(count), "", ""];
        }
        const onHand = book.onHand(effectId);
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

    if (!hasBook) {
      return outcomeCode(outcome);
    }

    if (args.switches.has("unused")) {
      // A stand-in counts as used even though the order list never names it,
      // otherwise the report suggests leaving behind the very cases the show
      // is going to be fired out of.
      const used = new Map(needed);
      for (const line of result.draw?.standIns ?? []) {
        used.set(line.substitute, used.get(line.substitute) ?? 0);
      }
      const spare = unusedStock(used, book);
      env.out("");
      env.out(
        spare.length === 0
          ? "every line in the magazine is used by this show"
          : `not used by this show: ${spare.join(", ")}`,
      );
    }

    const covering = new Map<string, StandIn[]>();
    for (const line of result.draw?.standIns ?? []) {
      covering.set(line.wanted, [...(covering.get(line.wanted) ?? []), line]);
    }

    const missing = shortfall(needed, book);
    env.out("");
    if (missing.length === 0 && covering.size === 0) {
      env.out("everything on the shot list is in stock");
      return outcomeCode(outcome);
    }
    for (const line of missing) {
      env.err(`short ${line.short} of ${line.effectId}`);
      for (const stood of covering.get(line.effectId) ?? []) {
        env.err(`  ${describeStandIn(stood)}`);
      }
      covering.delete(line.effectId);
    }
    // Anything still here was covered without the book being short of it,
    // which is what setting a lot aside does.
    for (const [wanted, lines] of covering) {
      env.err(`${wanted} ran out at the draw`);
      for (const stood of lines) {
        env.err(`  ${describeStandIn(stood)}`);
      }
    }
    return missing.length === 0 ? outcomeCode(outcome) : EXIT_SHOW_PROBLEM;
  },
};

function describeStandIn(line: StandIn): string {
  const lots = `${line.lots.length === 1 ? "lot" : "lots"} ${line.lots.join(", ")}`;
  return `${plural(line.shots, "cue")} drawn as ${line.substitute} from ${lots}`;
}
