import { firstFreePin } from "./module.js";
import type { PinAddress } from "./pin.js";
import { comparePins, formatPin, pinKey } from "./pin.js";
import type { Rig } from "./rig.js";
import { countBy } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { ResolvedShot } from "../script/resolve.js";
import { raw } from "../core/units.js";
import {
  chainKeyOf,
  chainsOf,
  describeRun,
  isFollower,
  isFused,
} from "../timeline/fusing.js";

/**
 * Giving every shot an output to fire from.
 *
 * The naive allocator hands out the lowest free pin at the right position, and
 * for a small show that is fine. For a ripple it is actively bad, because
 * consecutive shots land on consecutive pins of the same module and a module
 * can only fire a handful of outputs at once. A twenty shot ripple at forty
 * millisecond spacing on one module will not come out as a ripple. It will
 * come out as whatever the module manages.
 *
 * So the allocator spreads a run across the modules at a position, round robin,
 * and only fills a module up when there is nowhere else to go. This costs
 * nothing on a small show and quietly saves a large one.
 */

export interface Assignment {
  readonly shot: ResolvedShot;
  readonly address: PinAddress;
}

export interface AllocationOptions {
  /** Fill each module before moving on, rather than spreading across them. */
  readonly packTight?: boolean;
}

export interface Allocation {
  readonly assignments: readonly Assignment[];
  readonly diagnostics: DiagnosticBag;
}

export function allocatePins(
  shots: readonly ResolvedShot[],
  rig: Rig,
  options: AllocationOptions = {},
): Allocation {
  const diagnostics = new DiagnosticBag();
  const taken = new Set<string>();
  const assignments: Assignment[] = [];
  const cursor = new Map<string, number>();
  const exhausted = new Set<string>();

  // Fixed pins are claimed first, whatever order they appear in, so an auto
  // shot earlier in the show cannot steal a pin a later cue insisted on.
  for (const shot of shots) {
    if (shot.fixedPin !== undefined) {
      taken.add(pinKey(shot.fixedPin));
    }
  }

  const ordered = [...shots].sort((a, b) => raw(a.at) - raw(b.at));

  // A chained run is one circuit. The head takes a pin the way any single
  // shot would, and every shot lit by the fuse after it sits on that same
  // address, taking nothing from the rig and moving no cursor. A head that
  // found no pin has already been reported, and its run goes with it.
  const chainHeads = new Map<string, PinAddress>();

  for (const shot of ordered) {
    if (isFollower(shot)) {
      const head = chainHeads.get(chainKeyOf(shot));
      if (head !== undefined) {
        assignments.push({ shot, address: head });
      }
      continue;
    }
    if (shot.fixedPin !== undefined) {
      if (isFused(shot)) {
        chainHeads.set(chainKeyOf(shot), shot.fixedPin);
      }
      assignments.push({ shot, address: shot.fixedPin });
      continue;
    }
    const modules = rig.modulesAt(shot.position);
    if (modules.length === 0) {
      if (!exhausted.has(shot.position)) {
        exhausted.add(shot.position);
        diagnostics.error({
          code: "PF2400",
          message: `no module stands at ${shot.position}, so nothing can fire there`,
          span: shot.origin,
        });
      }
      continue;
    }

    let address: PinAddress | undefined;
    if (options.packTight ?? false) {
      for (const unit of modules) {
        address = firstFreePin(unit, taken);
        if (address !== undefined) {
          break;
        }
      }
    } else {
      const start = cursor.get(shot.position) ?? 0;
      for (let step = 0; step < modules.length; step += 1) {
        const unit = modules[(start + step) % modules.length];
        if (unit === undefined) {
          continue;
        }
        address = firstFreePin(unit, taken);
        if (address !== undefined) {
          cursor.set(shot.position, (start + step + 1) % modules.length);
          break;
        }
      }
    }

    if (address === undefined) {
      if (!exhausted.has(shot.position)) {
        exhausted.add(shot.position);
        const pins = rig.pinsAt(shot.position).length;
        diagnostics.error({
          code: "PF2401",
          message: `${shot.position} has run out of pins, all ${pins} are taken`,
          span: shot.origin,
          help: "add a module at that position or move some cues elsewhere",
        });
      }
      continue;
    }
    taken.add(pinKey(address));
    assignments.push({ shot, address });
    if (isFused(shot)) {
      chainHeads.set(chainKeyOf(shot), address);
    }
  }

  return { assignments, diagnostics };
}

/** Assignments in pin order, which is the order a crew wires the field. */
export function byPin(assignments: readonly Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => comparePins(a.address, b.address));
}

/** Assignments in firing order, which is the order the panel runs them. */
export function byTime(assignments: readonly Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    const gap = raw(a.shot.at) - raw(b.shot.at);
    return gap !== 0 ? gap : comparePins(a.address, b.address);
  });
}

export interface ModuleLoad {
  readonly module: number;
  readonly used: number;
  readonly capacity: number;
}

export function moduleLoads(
  assignments: readonly Assignment[],
  rig: Rig,
): ModuleLoad[] {
  // Pins, not shots: a chained run of twelve holds one output.
  const used = countBy(onePerPin(assignments), (assignment) =>
    String(assignment.address.module),
  );
  return rig.allModules().map((unit) => ({
    module: unit.number,
    used: used.get(String(unit.number)) ?? 0,
    capacity: unit.model.pins,
  }));
}

/** The first assignment on each pin, which is what a pin count counts. */
export function onePerPin(assignments: readonly Assignment[]): Assignment[] {
  const seen = new Map<string, Assignment>();
  for (const assignment of assignments) {
    if (!seen.has(pinKey(assignment.address))) {
      seen.set(pinKey(assignment.address), assignment);
    }
  }
  return [...seen.values()];
}

/** Pins wired to nothing, which the crew does not need to run leads to. */
export function unusedPins(
  assignments: readonly Assignment[],
  rig: Rig,
): PinAddress[] {
  const used = new Set(assignments.map((a) => pinKey(a.address)));
  return rig.allPins().filter((address) => !used.has(pinKey(address)));
}

export function describeAllocation(assignments: readonly Assignment[]): string {
  const runs = chainsOf(
    assignments.map((a) => ({
      address: a.address,
      ...(a.shot.fuse === undefined ? {} : { fuse: a.shot.fuse }),
    })),
  );
  const listed = new Set<string>();
  const lines: string[] = [];
  for (const assignment of byPin(assignments)) {
    const key = pinKey(assignment.address);
    if (listed.has(key)) {
      continue;
    }
    listed.add(key);
    const run = runs.get(key);
    const note = run === undefined ? "" : `  ${describeRun(run)}`;
    lines.push(
      `${formatPin(assignment.address)}  ${assignment.shot.effect}${note}`,
    );
  }
  return lines.join("\n");
}
