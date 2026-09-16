import type { Assignment } from "./allocate.js";
import type { PinAddress } from "./pin.js";
import { comparePins, formatPin } from "./pin.js";
import type { Rig } from "./rig.js";
import { countBy, groupBy, sortedEntries } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { renderTable } from "../core/text.js";
import { raw } from "../core/units.js";
import { calibreOf } from "../catalog/effect.js";
import type { Effect } from "../catalog/effect.js";

/**
 * Laying out the racks.
 *
 * A firing position is not one rack, it is a row of them, and mortars of
 * different bores do not share a rack. A six inch tube will not fit a three
 * inch rack and a three inch shell dropped into a six inch tube does not lift.
 * So the layout question is how many racks of each bore a position needs, and
 * in what order to stand them so the crew can wire along the row rather than
 * walking back and forth.
 *
 * The order that works is by pin, because that is the order the wiring sheet
 * is in and the order the crew works through. A layout sorted by anything else
 * sends somebody back down the row.
 */

/** Tubes in a standard rack, by bore. Bigger tubes mean fewer per rack. */
export function tubesPerRack(boreMm: number): number {
  if (boreMm <= 0) {
    return 1;
  }
  if (boreMm <= 75) {
    return 12;
  }
  if (boreMm <= 100) {
    return 10;
  }
  if (boreMm <= 150) {
    return 6;
  }
  if (boreMm <= 200) {
    return 4;
  }
  return 1;
}

export interface RackNeed {
  readonly position: string;
  readonly boreMm: number;
  readonly tubes: number;
  readonly racks: number;
  /** Pins the tubes of this bore are wired to, in wiring order. */
  readonly pins: readonly PinAddress[];
}

function boreOf(effect: Effect): number {
  const size = calibreOf(effect);
  return size === undefined ? 0 : Math.round(raw(size.size));
}

export function rackNeeds(assignments: readonly Assignment[]): RackNeed[] {
  const groups = groupBy(
    assignments,
    (assignment) =>
      `${assignment.shot.position}|${boreOf(assignment.shot.resolved)}`,
  );
  const needs: RackNeed[] = [];
  for (const [key, group] of sortedEntries(groups)) {
    const [position = "", boreText = "0"] = key.split("|");
    const boreMm = Number(boreText);
    const perRack = tubesPerRack(boreMm);
    needs.push({
      position,
      boreMm,
      tubes: group.length,
      racks: Math.ceil(group.length / perRack),
      pins: group.map((assignment) => assignment.address).sort(comparePins),
    });
  }
  return needs.sort(
    (a, b) => a.position.localeCompare(b.position) || b.boreMm - a.boreMm,
  );
}

/** How many racks of each bore the whole show needs, for the load out. */
export function rackTotals(needs: readonly RackNeed[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const need of needs) {
    if (need.boreMm === 0) {
      continue;
    }
    const key = `${need.boreMm}mm`;
    totals.set(key, (totals.get(key) ?? 0) + need.racks);
  }
  return totals;
}

export interface LayoutOptions {
  /** Most racks a crew will stand at one position before splitting it. */
  readonly maxRacksPerPosition?: number;
}

export function checkLayout(
  needs: readonly RackNeed[],
  options: LayoutOptions = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  // Eight racks is about forty tubes in one row, which is as far as a crew
  // will run a wiring pass before the walk back starts costing more than the
  // extra position would.
  const cap = options.maxRacksPerPosition ?? 8;
  const perPosition = new Map<string, number>();
  for (const need of needs) {
    perPosition.set(
      need.position,
      (perPosition.get(need.position) ?? 0) + need.racks,
    );
    if (need.boreMm === 0) {
      continue;
    }
    const perRack = tubesPerRack(need.boreMm);
    const spare = need.racks * perRack - need.tubes;
    if (need.racks > 1 && spare >= perRack - 1) {
      diagnostics.note({
        code: "PF1800",
        message: `${need.position} has ${spare} spare ${need.boreMm}mm tubes across ${need.racks} racks`,
      });
    }
  }
  for (const [position, racks] of sortedEntries(perPosition)) {
    if (racks > cap) {
      diagnostics.warning({
        code: "PF1801",
        message: `${position} needs ${racks} racks, over the ${cap} a crew will stand in one row`,
        help: "split it into two positions, the wiring run gets unmanageable",
      });
    }
  }
  return diagnostics;
}

/** Bores that share a position, which needs racks of two sizes side by side. */
export function mixedBorePositions(
  needs: readonly RackNeed[],
): Map<string, number[]> {
  const bores = new Map<string, number[]>();
  for (const need of needs) {
    if (need.boreMm === 0) {
      continue;
    }
    const held = bores.get(need.position) ?? [];
    held.push(need.boreMm);
    bores.set(need.position, held);
  }
  for (const [position, list] of bores) {
    if (list.length < 2) {
      bores.delete(position);
    } else {
      list.sort((a, b) => b - a);
    }
  }
  return bores;
}

export function describeLayout(needs: readonly RackNeed[]): string {
  return renderTable(
    [
      { header: "position" },
      { header: "bore", align: "right" },
      { header: "tubes", align: "right" },
      { header: "racks", align: "right" },
      { header: "first pin" },
      { header: "last pin" },
    ],
    needs.map((need) => {
      const first = need.pins[0];
      const last = need.pins[need.pins.length - 1];
      return [
        need.position,
        need.boreMm === 0 ? "ground" : `${need.boreMm}mm`,
        String(need.tubes),
        String(need.racks),
        first === undefined ? "" : formatPin(first),
        last === undefined ? "" : formatPin(last),
      ];
    }),
  );
}

/** A count of tubes per bore across the show, for the hire order. */
export function tubeOrder(
  assignments: readonly Assignment[],
): Map<string, number> {
  return countBy(
    assignments.filter((assignment) => boreOf(assignment.shot.resolved) > 0),
    (assignment) => `${boreOf(assignment.shot.resolved)}mm`,
  );
}

/** Which rig positions carry nothing, so the racks need not be carried out. */
export function unusedPositions(
  assignments: readonly Assignment[],
  rig: Rig,
): string[] {
  const used = new Set(
    assignments.map((assignment) => assignment.shot.position),
  );
  return rig.positionIds().filter((id) => !used.has(id));
}
