import type { Assignment } from "./allocate.js";
import { firstFreePin } from "./module.js";
import type { PinAddress } from "./pin.js";
import { comparePins, formatPin, pinKey } from "./pin.js";
import type { Rig } from "./rig.js";
import { calibreOf, isAerial } from "../catalog/effect.js";
import { countBy } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { renderTable } from "../core/text.js";
import { raw } from "../core/units.js";
import { isFollower } from "../timeline/fusing.js";

/**
 * Two matches on the cues that matter.
 *
 * A single electric match fails often enough that a display of four hundred
 * cues will lose a few, and losing one of four hundred does not matter. Losing
 * the twelve inch that opens the show does. So the ones that carry weight get
 * two matches on two outputs, fired on the same tick, and the cue goes if
 * either works.
 *
 * It costs a pin and a lead per cue, which is why it is not done to everything.
 * The judgement about which cues carry weight is the interesting part, and it
 * is not something a program should make alone, so the default rule is a
 * starting point a crew overrides rather than an answer.
 */

export interface RedundancyRule {
  /** Anything at or above this bore is worth doubling. */
  readonly fromCalibreMm?: number;
  /** Effect names to double whatever their bore. */
  readonly always?: readonly string[];
  /** Labels to double, which is how a designer marks the ones that matter. */
  readonly labels?: readonly string[];
  /** Never double these, whatever the other rules say. */
  readonly never?: readonly string[];
}

const DEFAULT_FROM_MM = 150;

export function shouldDouble(
  assignment: Assignment,
  rule: RedundancyRule = {},
): boolean {
  const effect = assignment.shot.resolved;
  if (rule.never?.includes(effect.id) ?? false) {
    return false;
  }
  if (rule.always?.includes(effect.id) ?? false) {
    return true;
  }
  const label = assignment.shot.label;
  if (label !== undefined && (rule.labels?.includes(label) ?? false)) {
    return true;
  }
  const size = calibreOf(effect);
  if (size === undefined) {
    return false;
  }
  const from = rule.fromCalibreMm ?? DEFAULT_FROM_MM;
  return raw(size.size) >= from;
}

export interface DoubledCue {
  readonly assignment: Assignment;
  readonly primary: PinAddress;
  readonly backup?: PinAddress;
  readonly reason?: string;
}

/**
 * Give each cue that wants one a second pin, preferring a different module.
 * A backup on the same module as the primary protects against a bad lead and
 * a dud match, which is most of what goes wrong, but not against the module
 * itself, and the module is the one failure that takes a whole rack with it.
 */
export function planRedundancy(
  assignments: readonly Assignment[],
  rig: Rig,
  rule: RedundancyRule = {},
): DoubledCue[] {
  const taken = new Set(
    assignments.map((assignment) => pinKey(assignment.address)),
  );
  const plans: DoubledCue[] = [];

  for (const assignment of assignments) {
    // A chained run has one circuit, so it gets one backup, on its head.
    // The shots down the fuse have no match of their own to double.
    if (isFollower(assignment.shot) || !shouldDouble(assignment, rule)) {
      plans.push({ assignment, primary: assignment.address });
      continue;
    }
    const modules = rig.modulesAt(assignment.shot.position);
    const others = modules.filter(
      (unit) => unit.number !== assignment.address.module,
    );
    let backup: PinAddress | undefined;
    for (const unit of [...others, ...modules]) {
      backup = firstFreePin(unit, taken);
      if (backup !== undefined) {
        break;
      }
    }
    if (backup === undefined) {
      plans.push({
        assignment,
        primary: assignment.address,
        reason: `no free pin left at ${assignment.shot.position}`,
      });
      continue;
    }
    taken.add(pinKey(backup));
    plans.push({ assignment, primary: assignment.address, backup });
  }
  return plans;
}

export function doubledCount(plans: readonly DoubledCue[]): number {
  return plans.filter((plan) => plan.backup !== undefined).length;
}

/** Cues that wanted a backup and could not have one. */
export function unprotected(plans: readonly DoubledCue[]): DoubledCue[] {
  return plans.filter(
    (plan) => plan.backup === undefined && plan.reason !== undefined,
  );
}

/** Backups sharing a module with their primary, which is the weaker case. */
export function sameModuleBackups(plans: readonly DoubledCue[]): DoubledCue[] {
  return plans.filter(
    (plan) =>
      plan.backup !== undefined && plan.backup.module === plan.primary.module,
  );
}

export function checkRedundancy(plans: readonly DoubledCue[]): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const plan of unprotected(plans)) {
    diagnostics.warning({
      code: "PF1550",
      message: `${plan.assignment.shot.effect} on ${formatPin(plan.primary)} wanted a second match and there is nowhere to put it`,
      help: plan.reason ?? "add a module at that position",
    });
  }
  const weak = sameModuleBackups(plans);
  if (weak.length > 0) {
    diagnostics.note({
      code: "PF1551",
      message: `${weak.length} backups share a module with their primary`,
      help: "that covers a bad lead or a dud match, not a module failing",
    });
  }
  return diagnostics;
}

/** How many extra pins and leads the plan costs. */
export interface RedundancyCost {
  readonly extraPins: number;
  readonly byPosition: ReadonlyMap<string, number>;
}

export function redundancyCost(plans: readonly DoubledCue[]): RedundancyCost {
  const doubled = plans.filter((plan) => plan.backup !== undefined);
  return {
    extraPins: doubled.length,
    byPosition: countBy(doubled, (plan) => plan.assignment.shot.position),
  };
}

export function describeRedundancy(plans: readonly DoubledCue[]): string {
  const doubled = plans
    .filter((plan) => plan.backup !== undefined)
    .sort((a, b) => comparePins(a.primary, b.primary));
  if (doubled.length === 0) {
    return "nothing in this show is doubled";
  }
  return renderTable(
    [
      { header: "primary" },
      { header: "backup" },
      { header: "effect" },
      { header: "position" },
      { header: "note" },
    ],
    doubled.map((plan) => [
      formatPin(plan.primary),
      plan.backup === undefined ? "" : formatPin(plan.backup),
      plan.assignment.shot.effect,
      plan.assignment.shot.position,
      plan.backup !== undefined && plan.backup.module === plan.primary.module
        ? "same module"
        : "",
    ]),
  );
}

/** Effects the default rule would double, for a crew reviewing the choice. */
export function defaultCandidates(
  assignments: readonly Assignment[],
): string[] {
  return [
    ...new Set(
      assignments
        .filter((assignment) => shouldDouble(assignment))
        .map((assignment) => assignment.shot.effect),
    ),
  ].sort();
}

/** Whether an effect is the kind a crew would expect to see doubled. */
export function carriesWeight(assignment: Assignment): boolean {
  const effect = assignment.shot.resolved;
  if (!isAerial(effect)) {
    return false;
  }
  const size = calibreOf(effect);
  return size !== undefined && raw(size.size) >= DEFAULT_FROM_MM;
}
