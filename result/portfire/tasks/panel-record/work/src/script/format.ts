import type { CueStatement, Script, Statement } from "./ast.js";
import { formatShowTime } from "../core/timecode.js";
import { raw } from "../core/units.js";
import type { Metres, Milliseconds } from "../core/units.js";
import { formatPin } from "../rig/pin.js";

/**
 * Writing a script back out in one shape.
 *
 * A show is edited by several people and lives in version control, so the
 * value of a formatter here is the same as anywhere else: a diff shows what
 * changed rather than who typed it. The particular win is the time column. A
 * script written with times as bare seconds and one written with minute forms
 * are the same show, and diffing them is useless.
 *
 * The output is the input, not a normalised interpretation of it. Times are
 * printed as they will be read, clauses come out in a fixed order, and nothing
 * is added that was not written, so formatting a script twice gives the same
 * text as formatting it once.
 */

export interface ScriptFormatOptions {
  /** Spaces of indent inside a group. */
  readonly indent?: number;
  /** Print times as minutes and seconds rather than plain seconds. */
  readonly minuteTimes?: boolean;
}

function timeText(at: Milliseconds, minutes: boolean): string {
  if (minutes) {
    return formatShowTime(at);
  }
  const value = raw(at);
  const seconds = value / 1000;
  return Number.isInteger(seconds)
    ? seconds.toFixed(1)
    : String(Number(seconds.toFixed(3)));
}

function gapText(value: Milliseconds): string {
  const millis = raw(value);
  return millis % 1000 === 0 && millis !== 0
    ? `${millis / 1000}s`
    : `${millis}ms`;
}

function heightText(value: Metres): string {
  return String(Number(raw(value).toFixed(2)));
}

function trailersOf(statement: CueStatement): string[] {
  const parts: string[] = [];
  if (statement.kind === "fire") {
    if (statement.pin.kind === "fixed") {
      parts.push(
        `pin ${formatPin({ module: statement.pin.module, pin: statement.pin.pin })}`,
      );
    }
    if (statement.height !== undefined) {
      parts.push(`height ${heightText(statement.height)}`);
    }
  }
  if (statement.kind === "chase" && statement.passes !== 1) {
    parts.push(`passes ${statement.passes}`);
  }
  if (
    (statement.kind === "ripple" || statement.kind === "fan") &&
    statement.jitter !== undefined
  ) {
    parts.push(`jitter ${gapText(statement.jitter)}`);
  }
  if (statement.kind !== "play" && statement.label !== undefined) {
    const label = statement.label;
    parts.push(
      /^[a-z0-9._-]+$/i.test(label) ? `label ${label}` : `label "${label}"`,
    );
  }
  return parts;
}

export function formatCue(
  statement: CueStatement,
  options: ScriptFormatOptions = {},
): string {
  const minutes = options.minuteTimes ?? false;
  const at = `at ${timeText(statement.at, minutes)}`;
  const trailers = trailersOf(statement);
  const tail = trailers.length === 0 ? "" : ` ${trailers.join(" ")}`;

  switch (statement.kind) {
    case "fire":
      return `${at} fire ${statement.effect} from ${statement.position}${tail}`;
    case "ripple":
      return `${at} ripple ${statement.count} of ${statement.effect} from ${statement.position} every ${gapText(statement.every)}${tail}`;
    case "fan":
      return `${at} fan ${statement.count} of ${statement.effect} from ${statement.position} spread ${gapText(statement.spread)}${tail}`;
    case "chase":
      return `${at} chase ${statement.effect} across ${statement.positions.join(" ")} every ${gapText(statement.every)}${tail}`;
    case "play":
      return `${at} play ${statement.group}`;
  }
}

export function formatStatement(
  statement: Statement,
  options: ScriptFormatOptions = {},
): string[] {
  const indent = " ".repeat(options.indent ?? 2);
  switch (statement.kind) {
    case "show":
      return [`show ${statement.name}`];
    case "seed":
      return [`seed ${statement.seed}`];
    case "frame":
      return [`frame ${statement.rate}${statement.dropFrame ? " drop" : ""}`];
    case "include":
      return [`include "${statement.path}"`];
    case "group":
      return [
        `group ${statement.name}`,
        ...statement.body.map((inner) => indent + formatCue(inner, options)),
        "end",
      ];
    default:
      return [formatCue(statement, options)];
  }
}

/**
 * Blank lines go between the header block, each group, and the run of cues,
 * because that is where a reader's eye needs them and nowhere else.
 */
const HEADER_KINDS = new Set(["show", "seed", "frame", "include"]);

export function formatScript(
  script: Script,
  options: ScriptFormatOptions = {},
): string {
  const lines: string[] = [];
  let previous: string | undefined;
  for (const statement of script.statements) {
    const isHeader = HEADER_KINDS.has(statement.kind);
    const isGroup = statement.kind === "group";
    if (previous !== undefined) {
      const wasHeader = HEADER_KINDS.has(previous);
      if (isGroup || previous === "group" || (wasHeader && !isHeader)) {
        lines.push("");
      }
    }
    lines.push(...formatStatement(statement, options));
    previous = statement.kind;
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
