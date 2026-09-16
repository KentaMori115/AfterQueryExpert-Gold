import { SHOW_FLAGS, outcomeCode, runShow } from "./common.js";
import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag } from "../../core/diagnostic.js";
import { SourceFile } from "../../core/span.js";
import { annotateScript, stripAnnotations } from "../../script/annotate.js";
import { parseScript } from "../../script/parser.js";

/**
 * Writing the answers back into the script.
 *
 * `--write` rewrites in place, which is safe because the annotations are
 * stripped and regenerated rather than merged, so the worst an accidental run
 * does is put back what was already there.
 */
export const annotateCommand: Command = {
  name: "annotate",
  summary: "write each cue's firing time and pins into the script",
  usage: "annotate <script> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "write", kind: "switch", help: "rewrite the file in place" },
    { name: "strip", kind: "switch", help: "take existing annotations off" },
    { name: "no-pins", kind: "switch", help: "write the times only" },
    {
      name: "max-pins",
      kind: "value",
      help: "pins to spell out before summarising",
      fallback: "4",
    },
  ],
  run(args, env) {
    const path = args.positional[0];
    if (path === undefined) {
      env.err("name the script to annotate");
      return EXIT_BAD_USAGE;
    }

    if (args.switches.has("strip")) {
      const source = env.readFile(path);
      if (source === undefined) {
        env.err(`cannot read the script at ${path}`);
        return EXIT_BAD_USAGE;
      }
      const stripped = stripAnnotations(source);
      return write(stripped, path, args.switches.has("write"), env);
    }

    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err("the show does not compile, so the answers would be wrong");
      return EXIT_SHOW_PROBLEM;
    }
    const maxPins = requireNumber(args, "max-pins", {
      min: 1,
      integer: true,
    });
    if (!maxPins.ok) {
      env.err(maxPins.reason);
      return EXIT_BAD_USAGE;
    }

    const file = new SourceFile(path, outcome.inputs.source);
    const parsed = parseScript(file);
    const text = annotateScript(
      outcome.inputs.source,
      parsed.script,
      outcome.result.schedule,
      file,
      { pins: !args.switches.has("no-pins"), maxPins: maxPins.value },
    );
    const code = write(text, path, args.switches.has("write"), env);
    return code === EXIT_SHOW_PROBLEM ? code : outcomeCode(outcome);
  },
};

function write(
  text: string,
  path: string,
  inPlace: boolean,
  env: Parameters<Command["run"]>[1],
): number {
  if (!inPlace) {
    env.out(text.trimEnd());
    return 0;
  }
  if (!env.writeFile(path, text)) {
    env.err(`cannot write to ${path}`);
    return EXIT_SHOW_PROBLEM;
  }
  env.out(`wrote ${path}`);
  return 0;
}
