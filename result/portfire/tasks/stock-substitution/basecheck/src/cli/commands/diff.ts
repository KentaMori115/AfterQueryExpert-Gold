import { SHOW_FLAGS, readShow, runShow } from "./common.js";
import type { Command } from "../command.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import { compile } from "../../compile.js";
import { formatBag } from "../../core/diagnostic.js";
import { plural } from "../../core/text.js";
import {
  describeDiff,
  diffSchedules,
  needsRewiring,
  positionSummary,
  summariseDiff,
  walkOrder,
} from "../../timeline/diff.js";

/**
 * What changed since the version the field was wired to.
 *
 * The exit code is the interesting part. Zero when the panel can simply be
 * reloaded, one when somebody has to walk back out among the mortars, which is
 * the decision this exists to make and the one nobody wants to make by eye at
 * half past six.
 */
export const diffCommand: Command = {
  name: "diff",
  summary: "compare a show against an earlier version of itself",
  usage: "diff <script> --against <older.pf> [options]",
  flags: [
    ...SHOW_FLAGS,
    { name: "against", kind: "value", help: "the earlier script" },
    {
      name: "walk",
      kind: "switch",
      help: "print the pins a crew has to visit",
    },
    { name: "by-position", kind: "switch", help: "summarise per position" },
  ],
  run(args, env) {
    const olderPath = args.values.get("against");
    if (olderPath === undefined) {
      env.err("diff needs --against, the earlier script to compare with");
      return EXIT_BAD_USAGE;
    }
    const olderSource = env.readFile(olderPath);
    if (olderSource === undefined) {
      env.err(`cannot read the earlier script at ${olderPath}`);
      return EXIT_BAD_USAGE;
    }
    const outcome = runShow(args, env, { quiet: true });
    if (outcome === undefined) {
      return EXIT_BAD_USAGE;
    }
    if (outcome.result.diagnostics.hasErrors()) {
      env.err(formatBag(outcome.result.diagnostics));
      env.err(
        "the current show does not compile, so there is nothing to compare",
      );
      return EXIT_SHOW_PROBLEM;
    }
    const older = compile(olderSource, olderPath, outcome.inputs.options);
    if (older.diagnostics.hasErrors()) {
      env.err(formatBag(older.diagnostics));
      env.err(`${olderPath} does not compile, so there is nothing to compare`);
      return EXIT_SHOW_PROBLEM;
    }

    const changes = diffSchedules(older.schedule, outcome.result.schedule);
    const summary = summariseDiff(older.schedule, outcome.result.schedule);
    env.out(describeDiff(changes));
    env.out("");
    env.out(
      [
        plural(summary.added, "added", "added"),
        `${summary.removed} removed`,
        `${summary.moved} moved`,
        `${summary.swapped} swapped`,
        `${summary.unchanged} unchanged`,
      ].join(", "),
    );

    if (args.switches.has("by-position")) {
      env.out("");
      for (const line of positionSummary(changes, outcome.result.schedule)) {
        env.out(line);
      }
    }

    const rewire = needsRewiring(changes);
    if (args.switches.has("walk")) {
      env.out("");
      const pins = walkOrder(changes, outcome.result.schedule);
      env.out(
        pins.length === 0
          ? "no pin has to be touched"
          : `visit these pins: ${pins.join(" ")}`,
      );
    }
    env.out("");
    env.out(
      rewire
        ? "the field has to be rewired before this loads"
        : "reload the panel, the field is unchanged",
    );
    return rewire ? EXIT_SHOW_PROBLEM : EXIT_OK;
  },
};

/** Whether a path can be read, so a caller can check before compiling. */
export function canRead(
  path: string,
  read: (name: string) => string | undefined,
): boolean {
  return read(path) !== undefined;
}

/** Read the current show's inputs alone, for a caller building its own diff. */
export const readShowInputs = readShow;
