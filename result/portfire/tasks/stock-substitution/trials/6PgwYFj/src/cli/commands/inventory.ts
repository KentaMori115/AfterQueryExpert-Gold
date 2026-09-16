import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_SHOW_PROBLEM, EXIT_BAD_USAGE } from "../command.js";
import { describeStandIn } from "../../catalog/draw.js";
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
 *
 * It counts what the script asked for, not what the draw managed to put in the
 * tubes. A stand in covers a cue for tonight; it does not mean the shells were
 * there, and a shortfall that stops being reported the moment something else
 * gets fired instead is a shortfall nobody ever orders. So the numbers here are
 * the design's, the command still fails, and the stand ins are listed under the
 * line they covered so the crew can see what tonight will actually look like.
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

    // What the script asked for, which for a covered cue is not what fires.
    const needed = countBy(
      result.schedule.events,
      (event) => event.substitutedFor ?? event.effectId,
    );

    const bookPath = args.values.get("magazine");
    const magazine = outcome.inputs.options.magazine ?? new Magazine();

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
      // A stand in is stock this show touches, whatever the order list says,
      // so it does not belong on a list of what nobody is going to open.
      const touched = new Map(needed);
      for (const stood of result.draw?.standIns ?? []) {
        touched.set(
          stood.effectId,
          (touched.get(stood.effectId) ?? 0) + stood.shots,
        );
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
    const standIns = result.draw?.standIns ?? [];
    for (const line of missing) {
      env.err(`short ${line.short} of ${line.effectId}`);
      for (const stood of standIns.filter(
        (candidate) => candidate.askedFor === line.effectId,
      )) {
        env.err(`  ${describeStandIn(stood)}`);
      }
    }
    return EXIT_SHOW_PROBLEM;
  },
};
