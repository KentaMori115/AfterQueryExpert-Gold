import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { SourceFile } from "../../core/span.js";
import { parseScript } from "../../script/parser.js";
import {
  applyLabels,
  checkLabels,
  planLabels,
  previewLabel,
} from "../../script/renumber.js";

/**
 * Filling in the labels nobody types.
 *
 * Like `fmt` and `lint`, this reads the script alone. A label is a property of
 * the script rather than of a compiled show, and needing a catalog to add one
 * would keep it out of the editor, which is the only place anybody would use
 * it.
 */
export const labelCommand: Command = {
  name: "label",
  summary: "give every cue a stable label",
  usage: "label <script> [options]",
  flags: [
    { name: "write", kind: "switch", help: "rewrite the file in place" },
    { name: "check", kind: "switch", help: "report rather than rewrite" },
    {
      name: "preview",
      kind: "switch",
      help: "show the cues as they would read",
    },
  ],
  run(args, env) {
    const path = args.positional[0];
    if (path === undefined) {
      env.err("name the script to label");
      return EXIT_BAD_USAGE;
    }
    const source = env.readFile(path);
    if (source === undefined) {
      env.err(`cannot read the script at ${path}`);
      return EXIT_BAD_USAGE;
    }
    const file = new SourceFile(path, source);
    const parsed = parseScript(file);
    if (parsed.diagnostics.hasErrors()) {
      env.err(formatBag(parsed.diagnostics));
      env.err("a script that does not parse cannot be labelled");
      return EXIT_SHOW_PROBLEM;
    }

    const problems = checkLabels(parsed.script);
    const duplicates = problems.byCode("PF2610");
    if (duplicates.length > 0) {
      env.err(formatBag(problems));
    }

    const plans = planLabels(parsed.script);
    const missing = plans.filter((plan) => !plan.kept);

    if (args.switches.has("check")) {
      env.out(
        missing.length === 0
          ? `every cue in ${path} has a label`
          : `${missing.length} of ${plans.length} cues in ${path} have no label`,
      );
      return missing.length === 0 && duplicates.length === 0
        ? EXIT_OK
        : EXIT_SHOW_PROBLEM;
    }

    if (args.switches.has("preview")) {
      for (const plan of plans) {
        env.out(`${plan.kept ? "  " : "+ "}${previewLabel(plan)}`);
      }
      return EXIT_OK;
    }

    const text = applyLabels(source, parsed.script, file);
    if (!args.switches.has("write")) {
      env.out(text.trimEnd());
      return EXIT_OK;
    }
    if (!env.writeFile(path, text)) {
      env.err(`cannot write to ${path}`);
      return EXIT_SHOW_PROBLEM;
    }
    env.out(
      missing.length === 0
        ? `${path} was already fully labelled`
        : `labelled ${missing.length} cues in ${path}`,
    );
    return EXIT_OK;
  },
};
