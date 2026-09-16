import { OUT_FLAG, SHOW_FLAGS, emit, outcomeCode, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK } from "../command.js";
import {
  cueSheet,
  positionSheets,
  sheetHeader,
  wiringSheet,
} from "../../export/sheets.js";

/**
 * The paper.
 *
 * Unlike `table`, this will print a sheet from a show that has errors, with
 * the errors above it. That difference is on purpose. A firing table is loaded
 * into a machine that cannot judge it; a sheet is read by a person who can,
 * and half a cue sheet during a rehearsal is more use than none.
 */
export const sheetCommand: Command = {
  name: "sheet",
  summary: "print the cue sheet or the wiring sheet",
  usage: "sheet <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    {
      name: "kind",
      kind: "value",
      help: "which sheet to print",
      choices: ["cue", "wiring", "position"],
      fallback: "cue",
    },
    OUT_FLAG,
    { name: "no-header", kind: "switch", help: "leave the summary block out" },
    {
      name: "no-break",
      kind: "switch",
      help: "leave the break time column out",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env);
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const { inputs, result } = outcome;

    const kind = args.values.get("kind") ?? "cue";
    const blocks: string[] = [];
    if (!args.switches.has("no-header")) {
      blocks.push(sheetHeader(result.schedule, inputs.name));
    }
    switch (kind) {
      case "wiring":
        blocks.push(wiringSheet(result.schedule, inputs.workspace.rig));
        break;
      case "position": {
        const sheets = positionSheets(result.schedule);
        if (sheets.size === 0) {
          blocks.push("no cues, so no position sheets");
        }
        for (const [position, sheet] of sheets) {
          blocks.push(`${position}\n\n${sheet}`);
        }
        break;
      }
      default:
        blocks.push(
          cueSheet(result.schedule, {
            showBreak: !args.switches.has("no-break"),
          }),
        );
    }

    const wrote = emit(blocks.join("\n\n"), args, env, `the ${kind} sheet`);
    return wrote === EXIT_OK ? outcomeCode(outcome) : wrote;
  },
};
