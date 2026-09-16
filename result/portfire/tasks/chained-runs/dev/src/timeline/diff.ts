import type { QuantisedSchedule } from "./quantise.js";
import type { FiringEvent, Schedule } from "./schedule.js";
import { countBy, groupBy, sortedEntries } from "../core/collect.js";
import { renderTable } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import { comparePins, formatPin, pinKey } from "../rig/pin.js";
import { chainsOf, panelEvents } from "./fusing.js";

/**
 * What changed between two versions of a show.
 *
 * A show is revised a dozen times, and the revision that goes on the panel is
 * whichever file was last saved. The question everybody asks the afternoon of
 * the show is what is different from the version the crew wired to, and
 * answering it by diffing two firing tables in a spreadsheet does not work,
 * because inserting one cue near the start renumbers everything after it.
 *
 * So the comparison is by pin and effect rather than by row number. A cue that
 * kept its pin and moved in time is a moved cue, not a delete and an add, and
 * that distinction is the whole value of the report.
 */

export type ChangeKind = "added" | "removed" | "moved" | "swapped";

export interface Change {
  readonly kind: ChangeKind;
  readonly address: string;
  readonly effectId: string;
  /** For a move, how far it moved, positive meaning later. */
  readonly shiftMs?: number;
  /** For a swap, what used to be on that pin. */
  readonly wasEffectId?: string;
  readonly at: string;
  /** For a swap of a chained run, what about the run changed. */
  readonly note?: string;
}

/** Within this a cue counts as unchanged rather than moved. */
export const SAME_TIME_MS = 1;

function keyOf(event: FiringEvent): string {
  return pinKey(event.address);
}

/**
 * What a chained run is, as the crew wired it: how many tubes the fuse
 * reaches and how far apart. A run that kept its pin and its effect but
 * gained a tube or was cut to another interval has to be re-fused on the
 * field, which is a rewire in every sense that matters.
 */
function runShape(
  events: readonly FiringEvent[],
): Map<string, { readonly shots: number; readonly fuses: string }> {
  const shapes = new Map<string, { shots: number; fuses: string }>();
  for (const [key, run] of chainsOf(events)) {
    shapes.set(key, {
      shots: run.length,
      fuses: run.map((event) => raw(event.fuse ?? ms(0))).join(","),
    });
  }
  return shapes;
}

export function diffSchedules(
  before: Schedule | QuantisedSchedule,
  after: Schedule | QuantisedSchedule,
): Change[] {
  // A chained run is one cue on its head's pin: the head is what the panel
  // fires and what a crew visits, so the comparison is head to head.
  const oldByPin = new Map(
    panelEvents(before.events).map((event) => [keyOf(event), event]),
  );
  const newByPin = new Map(
    panelEvents(after.events).map((event) => [keyOf(event), event]),
  );
  const oldRuns = runShape(before.events);
  const newRuns = runShape(after.events);
  const changes: Change[] = [];

  for (const [key, event] of newByPin) {
    const previous = oldByPin.get(key);
    if (previous === undefined) {
      changes.push({
        kind: "added",
        address: formatPin(event.address),
        effectId: event.effectId,
        at: formatShowTime(event.ignitionAt),
      });
      continue;
    }
    if (previous.effectId !== event.effectId) {
      changes.push({
        kind: "swapped",
        address: formatPin(event.address),
        effectId: event.effectId,
        wasEffectId: previous.effectId,
        at: formatShowTime(event.ignitionAt),
      });
      continue;
    }
    const wasRun = oldRuns.get(key);
    const isRun = newRuns.get(key);
    if (wasRun?.shots !== isRun?.shots || wasRun?.fuses !== isRun?.fuses) {
      changes.push({
        kind: "swapped",
        address: formatPin(event.address),
        effectId: event.effectId,
        wasEffectId: previous.effectId,
        at: formatShowTime(event.ignitionAt),
        note: describeRunChange(wasRun, isRun),
      });
      continue;
    }
    const shift = raw(event.ignitionAt) - raw(previous.ignitionAt);
    if (Math.abs(shift) > SAME_TIME_MS) {
      changes.push({
        kind: "moved",
        address: formatPin(event.address),
        effectId: event.effectId,
        shiftMs: Math.round(shift),
        at: formatShowTime(event.ignitionAt),
      });
    }
  }

  for (const [key, event] of oldByPin) {
    if (!newByPin.has(key)) {
      changes.push({
        kind: "removed",
        address: formatPin(event.address),
        effectId: event.effectId,
        at: formatShowTime(event.ignitionAt),
      });
    }
  }

  return changes.sort((a, b) => a.address.localeCompare(b.address));
}

function describeRunChange(
  was: { readonly shots: number; readonly fuses: string } | undefined,
  now: { readonly shots: number; readonly fuses: string } | undefined,
): string {
  if (was === undefined && now !== undefined) {
    return `now a chain of ${now.shots}`;
  }
  if (was !== undefined && now === undefined) {
    return `no longer a chain of ${was.shots}`;
  }
  if (was !== undefined && now !== undefined && was.shots !== now.shots) {
    return `chain of ${was.shots} is now ${now.shots}`;
  }
  return "the fuse was cut to another interval";
}

export interface DiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly moved: number;
  readonly swapped: number;
  readonly unchanged: number;
  /** True when nothing at all differs, so the wired field is still right. */
  readonly identical: boolean;
}

export function summariseDiff(
  before: Schedule | QuantisedSchedule,
  after: Schedule | QuantisedSchedule,
): DiffSummary {
  const changes = diffSchedules(before, after);
  const counts = countBy(changes, (change) => change.kind);
  const touched = new Set(changes.map((change) => change.address));
  const unchanged = panelEvents(after.events).filter(
    (event) => !touched.has(formatPin(event.address)),
  ).length;
  return {
    added: counts.get("added") ?? 0,
    removed: counts.get("removed") ?? 0,
    moved: counts.get("moved") ?? 0,
    swapped: counts.get("swapped") ?? 0,
    unchanged,
    identical: changes.length === 0,
  };
}

/**
 * Whether the field has to be rewired. A cue that only moved in time needs
 * nothing done to the wiring, so a revision made entirely of moves can be
 * loaded onto the panel without anybody going back out among the mortars.
 */
export function needsRewiring(changes: readonly Change[]): boolean {
  return changes.some((change) => change.kind !== "moved");
}

/** The pins a crew has to visit, which is the practical output of a diff. */
export function pinsToVisit(changes: readonly Change[]): string[] {
  return changes
    .filter((change) => change.kind !== "moved")
    .map((change) => change.address)
    .sort();
}

export function describeDiff(changes: readonly Change[]): string {
  if (changes.length === 0) {
    return "nothing changed";
  }
  return renderTable(
    [
      { header: "pin" },
      { header: "change" },
      { header: "effect" },
      { header: "detail" },
    ],
    changes.map((change) => [
      change.address,
      change.kind,
      change.effectId,
      change.kind === "moved"
        ? `${(change.shiftMs ?? 0) > 0 ? "+" : ""}${change.shiftMs}ms to ${change.at}`
        : change.kind === "swapped"
          ? (change.note ?? `was ${change.wasEffectId}`)
          : change.at,
    ]),
  );
}

/** Changes grouped by the position they sit at, for splitting the work up. */
export function changesByPosition(
  changes: readonly Change[],
  after: Schedule | QuantisedSchedule,
): Map<string, Change[]> {
  const positionOf = new Map(
    after.events.map((event) => [formatPin(event.address), event.position]),
  );
  return groupBy(
    changes,
    (change) => positionOf.get(change.address) ?? "unknown",
  );
}

export function positionSummary(
  changes: readonly Change[],
  after: Schedule | QuantisedSchedule,
): string[] {
  return sortedEntries(changesByPosition(changes, after)).map(
    ([position, list]) => `${position}: ${list.length} changes`,
  );
}

/** Pins ordered the way a crew walks them, for the rewiring list. */
export function walkOrder(
  changes: readonly Change[],
  after: Schedule | QuantisedSchedule,
): string[] {
  const byAddress = new Map(
    after.events.map((event) => [formatPin(event.address), event]),
  );
  return [...changes]
    .filter((change) => change.kind !== "moved")
    .sort((a, b) => {
      const left = byAddress.get(a.address);
      const right = byAddress.get(b.address);
      if (left === undefined || right === undefined) {
        return a.address.localeCompare(b.address);
      }
      return comparePins(left.address, right.address);
    })
    .map((change) => change.address);
}
