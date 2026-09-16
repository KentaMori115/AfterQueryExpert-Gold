import type { FlagSpec, ParsedArgs } from "../args.js";
import { numberOf, valueOf } from "../args.js";
import type { CliEnv, Workspace } from "../env.js";
import { loadWorkspace } from "../env.js";
import { EXIT_BAD_USAGE, EXIT_OK, EXIT_SHOW_PROBLEM } from "../command.js";
import type { CompileOptions, CompileResult } from "../../compile.js";
import { compile } from "../../compile.js";
import { formatBag } from "../../core/diagnostic.js";
import type { TimecodeFormat } from "../../core/timecode.js";
import { metres, metresPerSecond, ms } from "../../core/units.js";
import type { DistanceRule } from "../../safety/distance.js";
import { point, site, straightLine } from "../../safety/site.js";
import type { Site } from "../../safety/site.js";
import { wind } from "../../safety/wind.js";
import type { Wind } from "../../safety/wind.js";

/**
 * The flags every show reading command shares.
 *
 * They are shared rather than repeated because a shooter running `check` and
 * then `table` on the same show has to be able to pass the same flags to both
 * and get the same answer. A command with its own spelling of `--rig` is a
 * command that will one day be run with the wrong rig.
 */

export const SHOW_FLAGS: readonly FlagSpec[] = [
  { name: "catalog", kind: "value", help: "the effect catalog csv" },
  { name: "rig", kind: "value", help: "the rig sheet" },
  {
    name: "frame",
    kind: "value",
    help: "frame rate the panel runs at",
    choices: ["24", "25", "30", "30drop"],
  },
  { name: "seed", kind: "value", help: "override the script's jitter seed" },
  {
    name: "pack",
    kind: "switch",
    help: "fill each module before moving to the next",
  },
  {
    name: "absorb-preroll",
    kind: "switch",
    help: "move the show so nothing fires before zero",
  },
  {
    name: "advice",
    kind: "switch",
    help: "also run the checks that are matters of judgement",
  },
  {
    name: "max-lit",
    kind: "value",
    help: "warn past this many effects lit at once",
  },
  {
    name: "lull",
    kind: "value",
    help: "warn past a gap this long, in seconds",
  },
  { name: "ceiling", kind: "value", help: "airspace ceiling in metres" },
  {
    name: "audience",
    kind: "value",
    help: "metres from the origin to the line",
  },
  { name: "wind", kind: "value", help: "wind speed in metres per second" },
  { name: "wind-from", kind: "value", help: "wind bearing in degrees" },
  {
    name: "rule",
    kind: "value",
    help: "separation rule",
    choices: ["nfpa-1123", "cen-category-4", "reduced"],
  },
];

export function frameFormat(args: ParsedArgs): TimecodeFormat | undefined {
  const value = valueOf(args, "frame");
  switch (value) {
    case "24":
      return { rate: 24, dropFrame: false };
    case "25":
      return { rate: 25, dropFrame: false };
    case "30":
      return { rate: 30, dropFrame: false };
    case "30drop":
      return { rate: 30, dropFrame: true };
    default:
      return undefined;
  }
}

/**
 * A rectangular site built from one number, which is the audience line's
 * distance from the origin. A real site comes from a survey and a drawing, but
 * a straight line at a stated distance is what a crew has on the first pass
 * and it catches the separation mistakes that matter.
 */
export function siteFromArgs(args: ParsedArgs): Site | undefined {
  const distance = numberOf(args, "audience");
  if (distance === undefined) {
    return undefined;
  }
  const reach = Math.max(distance * 4, 500);
  return site(
    "audience line",
    straightLine(
      "spectator line",
      point(-reach, -distance),
      point(reach, -distance),
    ),
  );
}

export function windFromArgs(args: ParsedArgs): Wind | undefined {
  const speed = numberOf(args, "wind");
  if (speed === undefined) {
    return undefined;
  }
  return wind(
    metresPerSecond(Math.max(0, speed)),
    numberOf(args, "wind-from") ?? 0,
  );
}

export interface ShowInputs {
  readonly workspace: Workspace;
  readonly source: string;
  readonly name: string;
  readonly options: CompileOptions;
}

/**
 * Read the script and everything round it. Returns nothing after printing the
 * reason, so a command can bail out with the usage code without repeating the
 * error handling five times.
 */
export function readShow(
  args: ParsedArgs,
  env: CliEnv,
): ShowInputs | undefined {
  const path = args.positional[0];
  if (path === undefined) {
    env.err("name the script to read");
    return undefined;
  }
  const source = env.readFile(path);
  if (source === undefined) {
    env.err(`cannot read the script at ${path}`);
    return undefined;
  }
  const workspace = loadWorkspace(env, {
    ...(valueOf(args, "catalog") === undefined
      ? {}
      : { catalog: valueOf(args, "catalog") as string }),
    ...(valueOf(args, "rig") === undefined
      ? {}
      : { rig: valueOf(args, "rig") as string }),
  });

  const format = frameFormat(args);
  const seed = valueOf(args, "seed");
  const maxLit = numberOf(args, "max-lit");
  const lull = numberOf(args, "lull");
  const ceiling = numberOf(args, "ceiling");
  const where = siteFromArgs(args);
  const air = windFromArgs(args);
  const rule = valueOf(args, "rule") as DistanceRule | undefined;

  const options: CompileOptions = {
    catalog: workspace.catalog,
    rig: workspace.rig,
    ...(format === undefined ? {} : { format }),
    ...(seed === undefined ? {} : { seed }),
    read: (path) => env.readFile(path),
    allocation: { packTight: args.switches.has("pack") },
    absorbPreRoll: args.switches.has("absorb-preroll"),
    advice: args.switches.has("advice"),
    density: {
      ...(maxLit === undefined ? {} : { maxSimultaneous: maxLit }),
      ...(lull === undefined ? {} : { lullThreshold: ms(lull * 1000) }),
    },
    ...(where === undefined
      ? {}
      : {
          safety: {
            site: where,
            ...(rule === undefined ? {} : { rule }),
            ...(air === undefined ? {} : { wind: air }),
            ...(ceiling === undefined ? {} : { ceiling: metres(ceiling) }),
          },
        }),
  };
  return { workspace, source, name: path, options };
}

/**
 * Read, compile and report, which is the first half of every show command.
 *
 * Every command had its own copy of this and they had drifted. Two printed
 * workspace problems before the compile and one after, and one of them decided
 * whether the show was clean without looking at the workspace at all, so a
 * missing catalog produced a table full of unresolved names. Pulling it into
 * one place is the only way that stays fixed.
 */
export interface RunOutcome {
  readonly inputs: ShowInputs;
  readonly result: CompileResult;
  /** True when neither the workspace nor the show raised an error. */
  readonly clean: boolean;
}

export interface RunOptions {
  /** Print the show's own diagnostics. Off for a command that summarises. */
  readonly quiet?: boolean;
}

export function runShow(
  args: ParsedArgs,
  env: CliEnv,
  options: RunOptions = {},
): RunOutcome | undefined {
  const inputs = readShow(args, env);
  if (inputs === undefined) {
    return undefined;
  }
  if (inputs.workspace.diagnostics.size > 0) {
    env.err(formatBag(inputs.workspace.diagnostics));
  }
  const result = compile(inputs.source, inputs.name, inputs.options);
  if (!(options.quiet ?? false) && result.diagnostics.size > 0) {
    env.err(formatBag(result.diagnostics));
  }
  return {
    inputs,
    result,
    clean: result.ok && !inputs.workspace.diagnostics.hasErrors(),
  };
}

/** The exit code an outcome implies, for a command with nothing else to say. */
export function outcomeCode(outcome: RunOutcome): number {
  return outcome.clean ? EXIT_OK : EXIT_SHOW_PROBLEM;
}

/**
 * Send a document to standard output or to a file.
 *
 * Six commands had their own copy of this and they had drifted in the two
 * ways that matter. Three trimmed the trailing newline and three did not, so
 * piping two of them into one file gave a blank line between them or did not,
 * depending which two. And two of them reported a failed write on standard
 * output rather than standard error, where a script redirecting output would
 * silently collect the error message as part of the document.
 */
export function emit(
  text: string,
  args: ParsedArgs,
  env: CliEnv,
  what: string,
): number {
  const out = valueOf(args, "out");
  if (out === undefined) {
    env.out(text.trimEnd());
    return EXIT_OK;
  }
  if (!env.writeFile(out, text)) {
    env.err(`cannot write to ${out}`);
    return EXIT_SHOW_PROBLEM;
  }
  env.out(`wrote ${what} to ${out}`);
  return EXIT_OK;
}

/** The flag every command that can write a document shares. */
export const OUT_FLAG: FlagSpec = {
  name: "out",
  kind: "value",
  help: "write here instead of standard output",
};

export const USAGE_CODE = EXIT_BAD_USAGE;
