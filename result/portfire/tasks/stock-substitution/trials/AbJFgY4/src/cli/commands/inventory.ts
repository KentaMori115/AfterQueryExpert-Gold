import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import type { StandInLine } from "../../catalog/draw.js";
import { shortfall, unusedStock } from "../../catalog/inventory.js";
import { countBy } from "../../core/collect.js";
import { formatBag } from "../../core/diagnostic.js";
import { compareIds } from "../../core/ids.js";
import { listPhrase, plural, renderTable } from "../../core/text.js";

/**
 * What the show needs against what is in the store.
 *
 * The answer a crew actually wants is the order list, and the order list is
 * the shortfall rather than the shot list. Printing the shot list alone means
 * somebody sits with two spreadsheets and subtracts, which is the step that
 * goes wrong at eleven at night the week before a show.
 *
 * The counts are of what the script asked for, not of what the compile managed
 * to draw. A stand in keeps the show firing but it buys nothing back: the six
 * inch palms are still short, somebody still has to order them or agree to the
 * substitute in writing, and this command still fails so that a build script
 * cannot quietly ship a show that is short. The stand ins are listed under the
 * line they cover, with the lots they came out of, because that list is what
 * the conversation with the designer is about.
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

    // What the script asked for, which is what a stand in was asked to cover
    // rather than what it fired.
    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );
    const magazine = inputs.magazine;
    const rows = [...needed.entries()]
      .sort((a, b) => compareIds(a[0], b[0]))
      .map(([effectId, count]) => {
        if (magazine === undefined) {
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

    if (magazine === undefined) {
      return outcomeCode(outcome);
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
    const standIns = result.draw?.standIns ?? [];
    for (const line of missing) {
      env.err(`short ${line.short} of ${line.effectId}`);
      for (const stood of standIns.filter(
        (entry) => entry.askedFor === line.effectId,
      )) {
        env.err(`  ${describeStandIn(stood)}`);
      }
    }
    return EXIT_SHOW_PROBLEM;
  },
};

/** One stand in, as it reads under the line it covers. */
function describeStandIn(line: StandInLine): string {
  const lots = listPhrase([...new Set(line.lots)]);
  return `${plural(line.shots, "shot")} drawn as ${line.standIn} from lot ${lots}`;
}
