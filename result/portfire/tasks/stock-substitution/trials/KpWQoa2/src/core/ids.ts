/**
 * The names a display gives to its own parts.
 *
 * Effects, firing positions, cues and modules are all referred to by dotted
 * names such as `shell.150.crackling-palm` or `pad.a`. The rules are
 * deliberately narrow. A name is lowercase, its segments are separated by
 * dots, and a segment holds letters, digits, hyphens and underscores. That
 * excludes spaces and mixed case, and it does so because these names end up in
 * CSV firing tables and in filenames on a panel's memory card, where a space
 * turns into a column break and mixed case turns into two different entries on
 * two different operating systems.
 */

const brand = Symbol("portfire.id");

type Id<K extends string> = string & { readonly [brand]: K };

export type EffectId = Id<"effect">;
export type PositionId = Id<"position">;
export type CueId = Id<"cue">;
export type ModuleId = Id<"module">;
export type ShowId = Id<"show">;

const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

export interface IdProblem {
  readonly kind:
    | "empty"
    | "uppercase"
    | "empty-segment"
    | "bad-character"
    | "too-long";
  readonly detail: string;
}

const MAX_ID_LENGTH = 120;

/** Say why a name is not usable, or nothing when it is fine. */
export function checkId(value: string): IdProblem | undefined {
  if (value.length === 0) {
    return { kind: "empty", detail: "a name cannot be empty" };
  }
  if (value.length > MAX_ID_LENGTH) {
    return {
      kind: "too-long",
      detail: `a name cannot be longer than ${MAX_ID_LENGTH} characters`,
    };
  }
  if (value !== value.toLowerCase()) {
    return {
      kind: "uppercase",
      detail: `write ${value} in lowercase, panels fold case inconsistently`,
    };
  }
  const parts = value.split(".");
  for (const part of parts) {
    if (part.length === 0) {
      return {
        kind: "empty-segment",
        detail: `${value} has an empty segment between two dots`,
      };
    }
    if (!SEGMENT.test(part)) {
      return {
        kind: "bad-character",
        detail: `${part} may hold only letters, digits, hyphen and underscore`,
      };
    }
  }
  return undefined;
}

export function isValidId(value: string): boolean {
  return checkId(value) === undefined;
}

function coerce<K extends string>(value: string, what: string): Id<K> {
  const problem = checkId(value);
  if (problem) {
    throw new RangeError(`bad ${what} name, ${problem.detail}`);
  }
  return value as Id<K>;
}

export function effectId(value: string): EffectId {
  return coerce<"effect">(value, "effect");
}

export function positionId(value: string): PositionId {
  return coerce<"position">(value, "position");
}

export function cueId(value: string): CueId {
  return coerce<"cue">(value, "cue");
}

export function moduleId(value: string): ModuleId {
  return coerce<"module">(value, "module");
}

export function showId(value: string): ShowId {
  return coerce<"show">(value, "show");
}

export function segments(value: Id<string>): string[] {
  return value.split(".");
}

/** Everything before the last dot, or nothing for a bare name. */
export function namespaceOf(value: Id<string>): string | undefined {
  const index = value.lastIndexOf(".");
  return index === -1 ? undefined : value.slice(0, index);
}

/** The last segment, which is what a cue sheet prints when space is short. */
export function leafOf(value: Id<string>): string {
  const index = value.lastIndexOf(".");
  return index === -1 ? value : value.slice(index + 1);
}

export function depthOf(value: Id<string>): number {
  return segments(value).length;
}

/**
 * True when `candidate` sits under `prefix`, so `shell` matches
 * `shell.150.palm` but `shellac` does not. The segment boundary check is the
 * whole point, since catalogs are filtered by prefix in the CLI.
 */
export function isUnder(candidate: Id<string>, prefix: string): boolean {
  if (candidate === prefix) {
    return true;
  }
  return candidate.startsWith(`${prefix}.`);
}

/**
 * Order names the way a person expects, which means `shell.75` sorts before
 * `shell.150` even though the text says otherwise. Segment comparison falls
 * back to plain text whenever either side is not a number.
 */
export function compareIds(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    if (l === r) {
      continue;
    }
    const ln = Number(l);
    const rn = Number(r);
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) {
      return ln - rn;
    }
    return l < r ? -1 : 1;
  }
  return left.length - right.length;
}

export function sortIds<T extends string>(values: readonly T[]): T[] {
  return [...values].sort(compareIds);
}

/** Build a name from parts, checking the result rather than the pieces. */
export function joinId(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(".");
}
