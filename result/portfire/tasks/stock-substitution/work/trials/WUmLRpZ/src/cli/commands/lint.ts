import { requireNumber } from "../args.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { formatBag, summarise } from "../../core/diagnostic.js";
import { SourceFile } from "../../core/span.js";
import { formatScript } from "../../script/format.js";
import { checkDuplicateGroups, loadScript } from "../../script/include.js";
import { lintScript } from "../../script/lint.js";
import { parseScript } from "../../script/parser.js";

/**
 * Reading a script on its own.
 *
 * Neither of these commands needs a catalog or a rig, which is the point. They
 * run in a pre commit hook and in a text editor on save, where the rest of the
 * show is not to hand and where waiting for a catalog to load would make them
 * too slow to leave switched on.
 */
export const lintCommand: Command = {
  name: "lint",
  summary: "check a script's style without needing a catalog or a rig",
  usage: "lint <script> [options]",
  flags: [
    {
      name: "quiet-seconds",
      kind: "value",
      help: "note a script gap longer than this",
      fallback: "20",
    },
    {
      name: "tight-ms",
      kind: "value",
      help: "warn about a run tighter than this",
      fallback: "60",
    },
    {
      name: "follow",
      kind: "switch",
      help: "load included files as well",
    },
  ],
  run(args, env) {
    const path = args.positional[0];
    if (path === undefined) {
      env.err("name the script to lint");
      return EXIT_BAD_USAGE;
    }
    const quiet = requireNumber(args, "quiet-seconds", { min: 0.001 });
    const tight = requireNumber(args, "tight-ms", { min: 0.001 });
    if (!quiet.ok) {
      env.err(quiet.reason);
      return EXIT_BAD_USAGE;
    }
    if (!tight.ok) {
      env.err(tight.reason);
      return EXIT_BAD_USAGE;
    }
    const quietSeconds = quiet.value;
    const tightIntervalMs = tight.value;

    if (args.switches.has("follow")) {
      const loaded = loadScript(path, (name) => env.readFile(name));
      if (loaded.diagnostics.size > 0) {
        env.err(formatBag(loaded.diagnostics));
      }
      if (loaded.diagnostics.hasErrors()) {
        return EXIT_SHOW_PROBLEM;
      }
      const bag = lintScript(loaded.script, { quietSeconds, tightIntervalMs });
      bag.addAll(checkDuplicateGroups(loaded.script).all());
      if (bag.size > 0) {
        env.err(formatBag(bag));
      }
      env.out(`${loaded.files.length} files, ${summarise(bag)}`);
      return bag.hasErrors() || bag.warningCount > 0
        ? EXIT_SHOW_PROBLEM
        : EXIT_OK;
    }

    const source = env.readFile(path);
    if (source === undefined) {
      env.err(`cannot read the script at ${path}`);
      return EXIT_BAD_USAGE;
    }
    const parsed = parseScript(new SourceFile(path, source));
    if (parsed.diagnostics.size > 0) {
      env.err(formatBag(parsed.diagnostics));
    }
    if (parsed.diagnostics.hasErrors()) {
      return EXIT_SHOW_PROBLEM;
    }
    const bag = lintScript(parsed.script, { quietSeconds, tightIntervalMs });
    if (bag.size > 0) {
      env.err(formatBag(bag));
    }
    env.out(summarise(bag));
    return bag.warningCount > 0 ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};

/**
 * Rewriting a script in the canonical shape. `--check` exists so this can sit
 * in continuous integration without the job needing to diff anything itself.
 */
export const formatCommand: Command = {
  name: "fmt",
  summary: "rewrite a script in the canonical shape",
  usage: "fmt <script> [options]",
  flags: [
    { name: "check", kind: "switch", help: "report rather than rewrite" },
    { name: "write", kind: "switch", help: "rewrite the file in place" },
    {
      name: "indent",
      kind: "value",
      help: "spaces inside a group",
      fallback: "2",
    },
    {
      name: "minutes",
      kind: "switch",
      help: "print times as minutes and seconds",
    },
  ],
  run(args, env) {
    const path = args.positional[0];
    if (path === undefined) {
      env.err("name the script to format");
      return EXIT_BAD_USAGE;
    }
    const source = env.readFile(path);
    if (source === undefined) {
      env.err(`cannot read the script at ${path}`);
      return EXIT_BAD_USAGE;
    }
    const indentCheck = requireNumber(args, "indent", {
      min: 0,
      max: 8,
      integer: true,
    });
    if (!indentCheck.ok) {
      env.err(indentCheck.reason);
      return EXIT_BAD_USAGE;
    }
    const indent = indentCheck.value;
    const parsed = parseScript(new SourceFile(path, source));
    if (parsed.diagnostics.hasErrors()) {
      env.err(formatBag(parsed.diagnostics));
      env.err("a script that does not parse cannot be formatted");
      return EXIT_SHOW_PROBLEM;
    }
    const formatted = formatScript(parsed.script, {
      indent,
      minuteTimes: args.switches.has("minutes"),
    });

    if (args.switches.has("check")) {
      if (formatted === source) {
        env.out(`${path} is already formatted`);
        return EXIT_OK;
      }
      env.err(`${path} is not formatted`);
      return EXIT_SHOW_PROBLEM;
    }
    if (args.switches.has("write")) {
      if (!env.writeFile(path, formatted)) {
        env.err(`cannot write to ${path}`);
        return EXIT_SHOW_PROBLEM;
      }
      env.out(
        formatted === source
          ? `${path} was already formatted`
          : `wrote ${path}`,
      );
      return EXIT_OK;
    }
    env.out(formatted.trimEnd());
    return EXIT_OK;
  },
};
