/**
 * Reading the command line.
 *
 * There is no argument parsing library here on purpose. The whole surface is a
 * command name, a handful of long flags and one or two paths, and every
 * library that would handle that also brings a dependency, a version policy
 * and its own opinion about how errors are printed. This is about a hundred
 * lines and it prints errors the way the rest of portfire does.
 *
 * Flags are long form only. Short flags read as clever and are unreadable in a
 * makefile six months later, and a crew running this on a laptop in a van is
 * reading somebody else's command, not writing their own.
 */

export type FlagKind = "switch" | "value";

export interface FlagSpec {
  readonly name: string;
  readonly kind: FlagKind;
  readonly help: string;
  /** What a value flag means when it is not given. */
  readonly fallback?: string;
  /** Only these values are accepted, for a flag with a fixed set. */
  readonly choices?: readonly string[];
}

export interface ParsedArgs {
  readonly positional: readonly string[];
  readonly switches: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, string>;
  readonly errors: readonly string[];
}

const FLAG = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/;

export function parseArgs(
  argv: readonly string[],
  specs: readonly FlagSpec[],
): ParsedArgs {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const positional: string[] = [];
  const switches = new Set<string>();
  const values = new Map<string, string>();
  const errors: string[] = [];
  let onlyPositional = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (onlyPositional) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      onlyPositional = true;
      continue;
    }
    const match = FLAG.exec(arg);
    if (!match) {
      if (arg.startsWith("-") && arg.length > 1) {
        errors.push(`${arg} is not a flag, portfire uses long flags only`);
        continue;
      }
      positional.push(arg);
      continue;
    }
    const name = match[1] ?? "";
    const inline = match[2];
    const spec = byName.get(name);
    if (spec === undefined) {
      const near = nearestFlag(name, specs);
      errors.push(
        near === undefined
          ? `unknown flag --${name}`
          : `unknown flag --${name}, did you mean --${near}`,
      );
      continue;
    }
    if (spec.kind === "switch") {
      if (inline !== undefined) {
        errors.push(`--${name} does not take a value`);
        continue;
      }
      switches.add(name);
      continue;
    }
    const value = inline ?? argv[i + 1];
    if (inline === undefined) {
      i += 1;
    }
    if (
      value === undefined ||
      (inline === undefined && value.startsWith("--"))
    ) {
      errors.push(`--${name} needs a value`);
      continue;
    }
    if (spec.choices !== undefined && !spec.choices.includes(value)) {
      errors.push(
        `--${name} takes one of ${spec.choices.join(", ")}, not ${value}`,
      );
      continue;
    }
    values.set(name, value);
  }

  for (const spec of specs) {
    if (
      spec.kind === "value" &&
      spec.fallback !== undefined &&
      !values.has(spec.name)
    ) {
      values.set(spec.name, spec.fallback);
    }
  }
  return { positional, switches, values, errors };
}

function nearestFlag(
  wanted: string,
  specs: readonly FlagSpec[],
): string | undefined {
  return specs.find(
    (spec) =>
      spec.name.startsWith(wanted) ||
      wanted.startsWith(spec.name) ||
      spec.name.replace(/-/g, "") === wanted.replace(/-/g, ""),
  )?.name;
}

export function switchOn(args: ParsedArgs, name: string): boolean {
  return args.switches.has(name);
}

export function valueOf(args: ParsedArgs, name: string): string | undefined {
  return args.values.get(name);
}

export function numberOf(args: ParsedArgs, name: string): number | undefined {
  const raw = args.values.get(name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export interface NumberRule {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

/**
 * A numeric flag with its range checked once.
 *
 * Eight commands were each doing this by hand and they had drifted. Three
 * rejected a value of zero, two accepted it, and one accepted the string
 * `soon` because it only checked for a negative number. Returning the reason
 * rather than printing it keeps the wording of the error with the command,
 * which is the part that legitimately differs.
 */
export type NumberCheck =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: string };

export function requireNumber(
  args: ParsedArgs,
  name: string,
  rule: NumberRule = {},
): NumberCheck {
  const text = args.values.get(name);
  if (text === undefined) {
    return { ok: false, reason: `--${name} needs a value` };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `--${name} takes a number, not ${text}` };
  }
  if ((rule.integer ?? false) && !Number.isInteger(value)) {
    return { ok: false, reason: `--${name} takes a whole number` };
  }
  if (rule.min !== undefined && value < rule.min) {
    return { ok: false, reason: `--${name} has to be at least ${rule.min}` };
  }
  if (rule.max !== undefined && value > rule.max) {
    return { ok: false, reason: `--${name} has to be at most ${rule.max}` };
  }
  return { ok: true, value };
}

/** Render the flag list for a help screen, one per line. */
export function flagHelp(specs: readonly FlagSpec[]): string {
  const width = specs.reduce(
    (widest, spec) => Math.max(widest, spec.name.length),
    0,
  );
  return specs
    .map((spec) => {
      const name = `--${spec.name}`.padEnd(width + 2);
      const fallback =
        spec.fallback === undefined ? "" : ` (default ${spec.fallback})`;
      const choices =
        spec.choices === undefined ? "" : ` [${spec.choices.join("|")}]`;
      return `  ${name}  ${spec.help}${choices}${fallback}`;
    })
    .join("\n");
}
