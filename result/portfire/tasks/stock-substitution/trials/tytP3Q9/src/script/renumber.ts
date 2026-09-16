import type { CueStatement, Script } from "./ast.js";
import { isCueStatement, isShotStatement } from "./ast.js";
import { formatCue } from "./format.js";
import { countBy } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { SourceFile } from "../core/span.js";
import { raw } from "../core/units.js";

/**
 * Giving every cue a name.
 *
 * A cue with a label keeps its own jitter stream across edits elsewhere in the
 * script, keeps its identity in a diff, and can be found by `explain` without
 * anybody counting rows. So labels are worth having on everything, and nobody
 * types them, because at the point of writing a cue the label is the least
 * interesting thing about it.
 *
 * The names are generated from what the cue is and when it happens rather than
 * from a counter, so inserting a cue at the start does not rename the rest.
 * That property is the whole point. A counter would make every later label
 * change and turn a one line edit into a whole file diff.
 */

const MAX_STEM = 24;

/**
 * A label has to lex as a word, and a word starts with a letter. That rules
 * out the obvious `150-palm-20`, which reads as the number 150 followed by
 * rubbish, so the stem keeps the effect's leading segment.
 */
function stemFor(statement: CueStatement): string {
  if (!isShotStatement(statement)) {
    return statement.group;
  }
  const seconds = Math.round(raw(statement.at) / 1000);
  const room = MAX_STEM - String(seconds).length - 1;
  const name = statement.effect
    .replace(/\./g, "-")
    .slice(0, Math.max(1, room))
    .replace(/-+$/, "");
  const stem = `${name}-${seconds}`;
  return /^[a-z_]/.test(stem) ? stem : `cue-${stem}`;
}

export interface LabelPlan {
  readonly statement: CueStatement;
  readonly label: string;
  /** True when the statement already had a label and keeps it. */
  readonly kept: boolean;
}

function cuesOf(script: Script): CueStatement[] {
  const cues: CueStatement[] = [];
  for (const statement of script.statements) {
    if (statement.kind === "group") {
      cues.push(...statement.body);
      continue;
    }
    if (isCueStatement(statement)) {
      cues.push(statement);
    }
  }
  return cues;
}

/**
 * Work out a label for every cue that lacks one, leaving the ones that have
 * one alone. Two cues that would take the same name get a suffix, in the order
 * they appear, so the names stay unique without a global counter.
 */
export function planLabels(script: Script): LabelPlan[] {
  const cues = cuesOf(script);
  const taken = new Set<string>();
  for (const statement of cues) {
    if (statement.kind !== "play" && statement.label !== undefined) {
      taken.add(statement.label);
    }
  }

  const plans: LabelPlan[] = [];
  for (const statement of cues) {
    if (statement.kind === "play") {
      continue;
    }
    if (statement.label !== undefined) {
      plans.push({ statement, label: statement.label, kept: true });
      continue;
    }
    const stem = stemFor(statement);
    let label = stem;
    let suffix = 2;
    while (taken.has(label)) {
      label = `${stem}-${suffix}`;
      suffix += 1;
    }
    taken.add(label);
    plans.push({ statement, label, kept: false });
  }
  return plans;
}

/** Labels used more than once, which break the identity they exist to give. */
export function duplicateLabels(script: Script): string[] {
  const labels: string[] = [];
  for (const statement of cuesOf(script)) {
    if (statement.kind !== "play" && statement.label !== undefined) {
      labels.push(statement.label);
    }
  }
  return [...countBy(labels, (label) => label).entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label)
    .sort();
}

export function checkLabels(script: Script): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const label of duplicateLabels(script)) {
    diagnostics.warning({
      code: "PF2610",
      message: `${label} is used as a label more than once`,
      help: "a label is an identity, and two cues sharing one confuses both",
    });
  }
  const plans = planLabels(script);
  const unlabelled = plans.filter((plan) => !plan.kept).length;
  if (unlabelled > 0 && plans.length > 0) {
    diagnostics.note({
      code: "PF2611",
      message: `${unlabelled} of ${plans.length} cues have no label`,
      help: "a labelled cue keeps its jitter and its identity across an edit",
    });
  }
  return diagnostics;
}

/**
 * Rewrite the script with the labels filled in. Lines that already carry a
 * label are left byte for byte alone, so the diff is only the lines that
 * gained one.
 */
export function applyLabels(
  source: string,
  script: Script,
  file: SourceFile,
): string {
  const byLine = new Map<number, LabelPlan>();
  for (const plan of planLabels(script)) {
    if (plan.kept) {
      continue;
    }
    byLine.set(file.positionAt(plan.statement.span.start).line, plan);
  }
  return source
    .split("\n")
    .map((line, index) => {
      const plan = byLine.get(index + 1);
      if (plan === undefined) {
        return line;
      }
      const hash = line.indexOf("#");
      const body = hash === -1 ? line : line.slice(0, hash);
      const comment = hash === -1 ? "" : ` ${line.slice(hash)}`;
      return `${body.trimEnd()} label ${plan.label}${comment}`;
    })
    .join("\n");
}

/** What a cue would look like once labelled, for a preview. */
export function previewLabel(plan: LabelPlan): string {
  const labelled =
    plan.statement.kind === "play"
      ? plan.statement
      : { ...plan.statement, label: plan.label };
  return formatCue(labelled);
}
