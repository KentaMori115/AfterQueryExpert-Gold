import { OUT_FLAG, SHOW_FLAGS, emit, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import {
  canWrite,
  firingTableCsv,
  uniformPinsPerModule,
} from "../../export/firingTable.js";
import type { AddressStyle, TimeStyle } from "../../export/firingTable.js";

/**
 * Writing the file that goes on the panel.
 *
 * This refuses to write anything from a show that did not compile cleanly.
 * That is a deliberate hard line rather than a warning, because a firing table
 * on a memory card has no provenance once it is there. Nobody standing at the
 * panel can tell whether it came from a clean run or from a run that printed
 * fourteen errors and wrote the file anyway.
 */
export const tableCommand: Command = {
  name: "table",
  summary: "write the firing table a panel loads",
  usage: "table <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    OUT_FLAG,
    {
      name: "address",
      kind: "value",
      help: "address style",
      choices: ["dotted", "flat", "module-pin"],
      fallback: "dotted",
    },
    {
      name: "time",
      kind: "value",
      help: "time column style",
      choices: ["elapsed", "timecode", "milliseconds"],
      fallback: "elapsed",
    },
    { name: "no-header", kind: "switch", help: "leave the header row out" },
    {
      name: "force",
      kind: "switch",
      help: "write even though the show did not compile cleanly",
    },
  ],
  run(args, env) {
    const outcome = runShow(args, env);
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    const { inputs, result, clean } = outcome;
    if (!clean && !args.switches.has("force")) {
      env.err("refusing to write a table from a show that did not compile");
      env.err("fix the errors, or pass --force if you know why you want it");
      return EXIT_SHOW_PROBLEM;
    }

    const style = (args.values.get("address") ?? "dotted") as AddressStyle;
    const check = canWrite(inputs.workspace.rig, style);
    if (!check.ok) {
      env.err(check.reason ?? `cannot write a ${style} address for this rig`);
      return EXIT_BAD_USAGE;
    }
    const pins = uniformPinsPerModule(inputs.workspace.rig);
    const csv = firingTableCsv(result.schedule, {
      addressStyle: style,
      timeStyle: (args.values.get("time") ?? "elapsed") as TimeStyle,
      format: result.schedule.format,
      includeHeader: !args.switches.has("no-header"),
      ...(pins === undefined ? {} : { pinsPerModule: pins }),
    });

    const wrote = emit(csv, args, env, `${result.schedule.events.length} cues`);
    if (wrote !== EXIT_OK) {
      return wrote;
    }
    return clean ? EXIT_OK : EXIT_SHOW_PROBLEM;
  },
};
