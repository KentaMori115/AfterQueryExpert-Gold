import type { Span } from "../core/span.js";
import type { Milliseconds } from "../core/units.js";
import type { Metres } from "../core/units.js";

/**
 * The shape of a parsed cue script.
 *
 * The tree is deliberately shallow. A cue script has no expressions, no
 * arithmetic and no conditionals, and adding them would be a mistake rather
 * than a feature. A show is a list of things happening at times, and the value
 * of the format is that a shooter can read a diff of it the morning of the
 * show and know exactly what changed.
 *
 * Every node carries the span it was parsed from, because every later stage
 * reports against source text and a node without a span produces a diagnostic
 * that says something is wrong somewhere.
 */

export interface Node {
  readonly span: Span;
}

/** How a shot picks the pin it fires from. */
export type PinChoice =
  | { readonly kind: "auto" }
  | { readonly kind: "fixed"; readonly module: number; readonly pin: number };

export interface FireStatement extends Node {
  readonly kind: "fire";
  readonly at: Milliseconds;
  readonly effect: string;
  readonly position: string;
  readonly pin: PinChoice;
  /** A lowered break, when the script asks for one. */
  readonly height?: Metres;
  /** A name for the cue, so a later statement or a report can refer to it. */
  readonly label?: string;
}

export interface RippleStatement extends Node {
  readonly kind: "ripple";
  readonly at: Milliseconds;
  readonly count: number;
  readonly effect: string;
  readonly position: string;
  readonly every: Milliseconds;
  readonly jitter?: Milliseconds;
  readonly label?: string;
  /** Fire the whole run from one output, the rest lit by quickmatch. */
  readonly chained?: true;
  /** The head's pin, when a chained run names one. */
  readonly pin?: PinChoice;
}

export interface ChaseStatement extends Node {
  readonly kind: "chase";
  readonly at: Milliseconds;
  readonly effect: string;
  /** Positions in the order the chase runs across them. */
  readonly positions: readonly string[];
  readonly every: Milliseconds;
  /** How many times round the list, so a chase can double back. */
  readonly passes: number;
  readonly label?: string;
}

export interface FanStatement extends Node {
  readonly kind: "fan";
  readonly at: Milliseconds;
  readonly count: number;
  readonly effect: string;
  readonly position: string;
  /** Gap between the outer shots, spread evenly across the fan. */
  readonly spread: Milliseconds;
  readonly jitter?: Milliseconds;
  readonly label?: string;
  /** Fire the whole fan from one output, the rest lit by quickmatch. */
  readonly chained?: true;
  /** The head's pin, when a chained fan names one. */
  readonly pin?: PinChoice;
}

export interface PlayStatement extends Node {
  readonly kind: "play";
  readonly at: Milliseconds;
  readonly group: string;
}

export type CueStatement =
  | FireStatement
  | RippleStatement
  | ChaseStatement
  | FanStatement
  | PlayStatement;

export interface GroupStatement extends Node {
  readonly kind: "group";
  readonly name: string;
  /** Times inside a group are relative to wherever the group is played. */
  readonly body: readonly CueStatement[];
}

export interface ShowStatement extends Node {
  readonly kind: "show";
  readonly name: string;
}

export interface SeedStatement extends Node {
  readonly kind: "seed";
  readonly seed: string;
}

export interface FrameStatement extends Node {
  readonly kind: "frame";
  readonly rate: number;
  readonly dropFrame: boolean;
}

export interface IncludeStatement extends Node {
  readonly kind: "include";
  readonly path: string;
}

export type Statement =
  | ShowStatement
  | SeedStatement
  | FrameStatement
  | GroupStatement
  | IncludeStatement
  | CueStatement;

export interface Script {
  readonly source: string;
  readonly statements: readonly Statement[];
}

const CUE_KINDS = new Set(["fire", "ripple", "chase", "fan", "play"]);

export function isCueStatement(
  statement: Statement,
): statement is CueStatement {
  return CUE_KINDS.has(statement.kind);
}

/** Statements that put shots in the air, so `play` does not count. */
export function isShotStatement(
  statement: Statement,
): statement is
  | FireStatement
  | RippleStatement
  | ChaseStatement
  | FanStatement {
  return isCueStatement(statement) && statement.kind !== "play";
}

/** How many shots a statement stands for, before any group is expanded. */
export function shotsIn(statement: Statement): number {
  switch (statement.kind) {
    case "fire":
      return 1;
    case "ripple":
    case "fan":
      return statement.count;
    case "chase":
      return statement.positions.length * statement.passes;
    default:
      return 0;
  }
}

/** Every effect a statement names, so a shot list can be built without a rig. */
export function effectsIn(statement: Statement): string[] {
  return isShotStatement(statement) ? [statement.effect] : [];
}

/** Whether a statement fires its run from one output. */
export function isChained(statement: Statement): boolean {
  return (
    (statement.kind === "ripple" || statement.kind === "fan") &&
    statement.chained === true
  );
}

/**
 * How many outputs a statement takes on the panel. A chained run takes one
 * whatever its count, which is the whole reason to chain it.
 */
export function outputsIn(statement: Statement): number {
  if (isChained(statement)) {
    return shotsIn(statement) > 0 ? 1 : 0;
  }
  return shotsIn(statement);
}

/** Every position a statement names. */
export function positionsIn(statement: Statement): string[] {
  switch (statement.kind) {
    case "fire":
    case "ripple":
    case "fan":
      return [statement.position];
    case "chase":
      return [...statement.positions];
    default:
      return [];
  }
}

/**
 * Walk every statement including the bodies of groups. The group itself is
 * visited before its body, so a caller building a scope sees the header first.
 */
export function walk(
  statements: readonly Statement[],
  visit: (statement: Statement, insideGroup: string | undefined) => void,
): void {
  for (const statement of statements) {
    visit(statement, undefined);
    if (statement.kind === "group") {
      for (const inner of statement.body) {
        visit(inner, statement.name);
      }
    }
  }
}

export function groupsIn(statements: readonly Statement[]): GroupStatement[] {
  return statements.filter(
    (statement): statement is GroupStatement => statement.kind === "group",
  );
}

export function findGroup(
  statements: readonly Statement[],
  name: string,
): GroupStatement | undefined {
  return groupsIn(statements).find((group) => group.name === name);
}

/** Total shots in the script, counting a played group once per play. */
export function totalShots(statements: readonly Statement[]): number {
  const groups = new Map(
    groupsIn(statements).map((group) => [
      group.name,
      group.body.reduce((total, inner) => total + shotsIn(inner), 0),
    ]),
  );
  let total = 0;
  for (const statement of statements) {
    if (statement.kind === "play") {
      total += groups.get(statement.group) ?? 0;
    } else if (statement.kind !== "group") {
      total += shotsIn(statement);
    }
  }
  return total;
}
