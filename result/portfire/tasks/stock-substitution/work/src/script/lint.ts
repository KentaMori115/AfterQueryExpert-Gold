import type { CueStatement, Script, Statement } from "./ast.js";
import { groupsIn, isShotStatement, shotsIn } from "./ast.js";
import { checkLabels } from "./renumber.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { formatShowTime } from "../core/timecode.js";
import type { Milliseconds } from "../core/units.js";
import { raw } from "../core/units.js";

/**
 * The mistakes a script can make while still being correct.
 *
 * These are not errors. Every one of them compiles, produces a firing table
 * and fires. They are the things a second pair of eyes would point at, and the
 * reason they are worth automating is that a show is written over six weeks
 * and nobody rereads the opening after writing the finale.
 *
 * Each rule earns its place by having been a real problem. A ripple written
 * with a forty millisecond gap because somebody typed the interval in the
 * wrong unit. A group written and never played. Two cues on the same beat from
 * the same position, which will not both fire from one rack.
 */

export interface LintOptions {
  /** A gap longer than this between cues is worth mentioning. */
  readonly quietSeconds?: number;
  /** A ripple tighter than this reads as one report at 25 frames. */
  readonly tightIntervalMs?: number;
}

const DEFAULT_QUIET_SECONDS = 20;
const DEFAULT_TIGHT_INTERVAL_MS = 60;

function cueStatements(script: Script): CueStatement[] {
  const out: CueStatement[] = [];
  for (const statement of script.statements) {
    if (statement.kind === "group") {
      out.push(...statement.body);
      continue;
    }
    if (isShotStatement(statement) || statement.kind === "play") {
      out.push(statement);
    }
  }
  return out;
}

function topLevelCues(script: Script): CueStatement[] {
  return script.statements.filter(
    (statement): statement is CueStatement =>
      isShotStatement(statement) || statement.kind === "play",
  );
}

export function lintScript(
  script: Script,
  options: LintOptions = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const tight = options.tightIntervalMs ?? DEFAULT_TIGHT_INTERVAL_MS;
  const quiet = (options.quietSeconds ?? DEFAULT_QUIET_SECONDS) * 1000;

  checkGroups(script, diagnostics);
  // Only the duplicates. A cue without a label is not a problem, it is a
  // missed convenience, and lint reporting it would train people to ignore
  // lint on every script that has not been through `label`.
  diagnostics.addAll(checkLabels(script).byCode("PF2610"));
  checkIntervals(script, diagnostics, tight);
  checkCollisions(script, diagnostics);
  checkQuiet(script, diagnostics, quiet);
  checkHeaders(script, diagnostics);
  return diagnostics;
}

function checkGroups(script: Script, diagnostics: DiagnosticBag): void {
  const played = new Set<string>();
  for (const statement of cueStatements(script)) {
    if (statement.kind === "play") {
      played.add(statement.group);
    }
  }
  for (const group of groupsIn(script.statements)) {
    if (!played.has(group.name)) {
      diagnostics.warning({
        code: "PF2600",
        message: `group ${group.name} is never played`,
        span: group.span,
        help: "either play it or delete it, an unplayed group is dead weight",
      });
    }
    if (group.body.length === 0) {
      diagnostics.warning({
        code: "PF2601",
        message: `group ${group.name} is empty`,
        span: group.span,
      });
    }
  }
}

function checkIntervals(
  script: Script,
  diagnostics: DiagnosticBag,
  tightMs: number,
): void {
  for (const statement of cueStatements(script)) {
    if (statement.kind === "ripple") {
      reportTight(statement.every, statement, diagnostics, tightMs, "ripple");
    }
    if (statement.kind === "chase") {
      reportTight(statement.every, statement, diagnostics, tightMs, "chase");
    }
    if (statement.kind === "fan" && raw(statement.spread) === 0) {
      diagnostics.warning({
        code: "PF2603",
        message: "a fan with no spread is just several shots at one instant",
        span: statement.span,
        help: "give it a spread, or write it as separate fire lines",
      });
    }
    if (shotsIn(statement) > 60) {
      diagnostics.note({
        code: "PF2604",
        message: `this ${statement.kind} is ${shotsIn(statement)} shots`,
        span: statement.span,
        help: "check the rig has that many free pins at the position",
      });
    }
  }
}

function reportTight(
  interval: Milliseconds,
  statement: CueStatement,
  diagnostics: DiagnosticBag,
  tightMs: number,
  what: string,
): void {
  if (raw(interval) > 0 && raw(interval) < tightMs) {
    diagnostics.warning({
      code: "PF2602",
      message: `this ${what} fires every ${raw(interval)}ms`,
      span: statement.span,
      help: "under a frame or two apart the whole run reads as one report",
    });
  }
}

function checkCollisions(script: Script, diagnostics: DiagnosticBag): void {
  const seen = new Map<string, CueStatement>();
  for (const statement of topLevelCues(script)) {
    if (statement.kind !== "fire") {
      continue;
    }
    const key = `${raw(statement.at)}|${statement.position}`;
    const previous = seen.get(key);
    if (previous !== undefined) {
      diagnostics.warning({
        code: "PF2605",
        message: `two cues fire from ${statement.position} at ${formatShowTime(statement.at)}`,
        span: statement.span,
        help: "one rack cannot fire two mortars on the same instant convincingly",
      });
      continue;
    }
    seen.set(key, statement);
  }
}

function checkQuiet(
  script: Script,
  diagnostics: DiagnosticBag,
  quietMs: number,
): void {
  const times = topLevelCues(script)
    .map((statement) => raw(statement.at))
    .sort((a, b) => a - b);
  for (let i = 1; i < times.length; i += 1) {
    const previous = times[i - 1];
    const current = times[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const gap = current - previous;
    if (gap >= quietMs) {
      diagnostics.note({
        code: "PF2606",
        message: `${(gap / 1000).toFixed(1)}s of script between cues at ${(previous / 1000).toFixed(1)}s and ${(current / 1000).toFixed(1)}s`,
        help: "the density check works on lit time, this one is about the script",
      });
    }
  }
}

function checkHeaders(script: Script, diagnostics: DiagnosticBag): void {
  const kinds = new Set(script.statements.map((s: Statement) => s.kind));
  if (!kinds.has("show")) {
    diagnostics.warning({
      code: "PF2607",
      message: "this script does not name the show",
      help: "the show name seeds the jitter, so an unnamed show is less stable",
    });
  }
  const seeds = script.statements.filter((s) => s.kind === "seed");
  if (seeds.length > 1) {
    diagnostics.warning({
      code: "PF2608",
      message: `there are ${seeds.length} seed lines, only the first is used`,
    });
  }
  const frames = script.statements.filter((s) => s.kind === "frame");
  if (frames.length > 1) {
    diagnostics.warning({
      code: "PF2609",
      message: `there are ${frames.length} frame lines, only the first is used`,
    });
  }
}

/** Whether a script is clean enough to hand to somebody else. */
export function lintClean(script: Script, options: LintOptions = {}): boolean {
  return lintScript(script, options).warningCount === 0;
}
