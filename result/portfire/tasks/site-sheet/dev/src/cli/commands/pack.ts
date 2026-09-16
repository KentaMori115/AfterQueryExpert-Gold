import {
  OUT_FLAG,
  SHOW_FLAGS,
  emit,
  outcomeCode,
  runShow,
  siteFor,
  siteNameFor,
} from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { sectionTitles, showPack } from "../../export/pack.js";
import type { PermitDetails } from "../../export/permit.js";
import type { DistanceRule } from "../../safety/distance.js";

/**
 * The whole folder, from one compile.
 *
 * Assembling this by hand from six commands is how a cue sheet and a permit
 * end up disagreeing about how many shells there are. Everything here comes
 * from the same schedule, so they cannot.
 */
export const packCommand: Command = {
  name: "pack",
  summary: "write the whole show pack as one document",
  usage: "pack <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    OUT_FLAG,
    {
      name: "without",
      kind: "value",
      help: "leave sections out, comma separated",
    },
    { name: "sections", kind: "switch", help: "list the sections and stop" },
    { name: "show-name", kind: "value", help: "name of the display" },
    { name: "site-name", kind: "value", help: "name of the site" },
    { name: "operator", kind: "value", help: "who is firing it" },
    { name: "licence", kind: "value", help: "licence or registration number" },
  ],
  run(args, env) {
    if (args.switches.has("sections")) {
      for (const title of sectionTitles()) {
        env.out(title);
      }
      return 0;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err("the show does not compile, so the pack would be wrong");
      return EXIT_SHOW_PROBLEM;
    }

    const known = new Set(sectionTitles());
    const without = (args.values.get("without") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const title of without) {
      if (!known.has(title)) {
        env.err(`${title} is not a section, run pack --sections for the list`);
        return EXIT_BAD_USAGE;
      }
    }

    const site = siteFor(args, outcome.inputs.workspace);
    const permit: PermitDetails | undefined =
      site === undefined
        ? undefined
        : {
            showName: args.values.get("show-name") ?? outcome.inputs.name,
            siteName: siteNameFor(args, site),
            ...(args.values.get("operator") === undefined
              ? {}
              : { operator: args.values.get("operator") as string }),
            ...(args.values.get("licence") === undefined
              ? {}
              : { licenceNumber: args.values.get("licence") as string }),
          };

    const text = showPack(outcome.result.schedule, {
      name: args.values.get("show-name") ?? outcome.inputs.name,
      rig: outcome.inputs.workspace.rig,
      assignments: outcome.result.assignments,
      diagnostics: outcome.result.diagnostics,
      without,
      ...(site === undefined ? {} : { site }),
      ...(permit === undefined ? {} : { permit }),
      ...(args.values.get("rule") === undefined
        ? {}
        : { rule: args.values.get("rule") as DistanceRule }),
    });

    const wrote = emit(text, args, env, "the show pack");
    return wrote === EXIT_OK ? outcomeCode(outcome) : wrote;
  },
};
