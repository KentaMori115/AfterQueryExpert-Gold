import type { FiringEvent } from "./schedule.js";
import type { QuantisedSchedule } from "./quantise.js";
import type { Schedule } from "./schedule.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { interval, peakOverlap } from "../core/interval.js";
import type { Interval } from "../core/interval.js";
import type { FiringModule } from "../rig/module.js";
import { perPinCurrent } from "../rig/module.js";
import { formatPin } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";
import type { Amperes, Milliseconds } from "../core/units.js";
import { amperes, ms, raw } from "../core/units.js";

/**
 * What the modules are actually being asked to do.
 *
 * A firing module closes an output for a pulse of a few tens of milliseconds
 * and draws current the whole time. Two cues on one module inside that pulse
 * share the module's supply, and past the module's simultaneous limit the
 * later ones either fire late or do not fire.
 *
 * This is the check that catches the show nobody thinks to check. A finale
 * written as one big ripple looks fine on paper, allocates cleanly, quantises
 * cleanly, and then asks a single module for twelve outputs in one frame.
 */

export interface PulseWindow {
  readonly event: FiringEvent;
  readonly window: Interval;
  readonly draw: Amperes;
}

export interface ModuleLoadReport {
  readonly module: number;
  readonly model: string;
  /** Most outputs live at any one instant. */
  readonly peakSimultaneous: number;
  readonly peakAt: Milliseconds;
  readonly peakCurrent: Amperes;
  readonly limit: number;
  readonly currentLimit: Amperes;
  readonly overSimultaneous: boolean;
  readonly overCurrent: boolean;
}

/**
 * What one output actually draws. By default this is the module's own supply
 * shared across its simultaneous limit, which is the manufacturer's own
 * figure. A rig running low resistance matches or series chains draws
 * something else, and the caller passes that in, which is the only way the
 * current check can ever disagree with the simultaneous check.
 */
export interface LoadOptions {
  readonly perPin?: Amperes;
}

function pulsesFor(
  events: readonly FiringEvent[],
  unit: FiringModule,
  options: LoadOptions = {},
): PulseWindow[] {
  const draw = options.perPin ?? perPinCurrent(unit.model);
  return events
    .filter((event) => event.address.module === unit.number)
    .map((event) => ({
      event,
      window: interval(
        event.ignitionAt,
        ms(raw(event.ignitionAt) + unit.model.pulseMs),
      ),
      draw,
    }));
}

export function moduleLoad(
  events: readonly FiringEvent[],
  unit: FiringModule,
  options: LoadOptions = {},
): ModuleLoadReport {
  const pulses = pulsesFor(events, unit, options);
  const peak = peakOverlap(pulses.map((pulse) => pulse.window));
  const perPin = raw(options.perPin ?? perPinCurrent(unit.model));
  const peakCurrent = amperes(peak.count * perPin);
  return {
    module: unit.number,
    model: unit.model.name,
    peakSimultaneous: peak.count,
    peakAt: peak.at,
    peakCurrent,
    limit: unit.model.simultaneous,
    currentLimit: unit.model.firingCurrent,
    overSimultaneous: peak.count > unit.model.simultaneous,
    overCurrent: raw(peakCurrent) > raw(unit.model.firingCurrent) + 1e-9,
  };
}

export function loadReport(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  options: LoadOptions = {},
): ModuleLoadReport[] {
  return rig
    .allModules()
    .map((unit) => moduleLoad(schedule.events, unit, options))
    .filter((report) => report.peakSimultaneous > 0);
}

export function checkLoad(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  options: LoadOptions = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const report of loadReport(schedule, rig, options)) {
    if (report.overSimultaneous) {
      diagnostics.error({
        code: "PF3100",
        message: `module ${report.module} is asked for ${report.peakSimultaneous} outputs at once and can do ${report.limit}`,
        help: "spread the run across more modules, or widen the interval",
      });
    }
    if (report.overCurrent && !report.overSimultaneous) {
      diagnostics.warning({
        code: "PF3101",
        message: `module ${report.module} peaks at ${raw(report.peakCurrent).toFixed(1)}A against a ${raw(report.currentLimit).toFixed(1)}A supply`,
      });
    }
  }
  return diagnostics;
}

/**
 * The busiest instant in the whole show, across every module. This is the
 * number a crew quotes when deciding whether the rig is big enough, and it is
 * not the sum of the per module peaks, since those rarely coincide.
 */
export interface ShowLoadPeak {
  readonly count: number;
  readonly at: Milliseconds;
}

export function showPeak(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  options: LoadOptions = {},
): ShowLoadPeak {
  const windows: Interval[] = [];
  for (const unit of rig.allModules()) {
    for (const pulse of pulsesFor(schedule.events, unit, options)) {
      windows.push(pulse.window);
    }
  }
  const peak = peakOverlap(windows);
  return { count: peak.count, at: peak.at };
}

/** Events that fire inside one module's pulse window of each other. */
export function crowdedEvents(
  schedule: Schedule | QuantisedSchedule,
  unit: FiringModule,
  options: LoadOptions = {},
): FiringEvent[][] {
  const pulses = pulsesFor(schedule.events, unit, options).sort(
    (a, b) => raw(a.window.start) - raw(b.window.start),
  );
  const groups: FiringEvent[][] = [];
  let current: PulseWindow[] = [];
  for (const pulse of pulses) {
    const last = current[current.length - 1];
    if (last !== undefined && raw(pulse.window.start) < raw(last.window.end)) {
      current.push(pulse);
    } else {
      if (current.length > 1) {
        groups.push(current.map((entry) => entry.event));
      }
      current = [pulse];
    }
  }
  if (current.length > 1) {
    groups.push(current.map((entry) => entry.event));
  }
  return groups;
}

export function describeLoad(report: ModuleLoadReport): string {
  const flag = report.overSimultaneous
    ? " OVER"
    : report.overCurrent
      ? " current"
      : "";
  return `module ${report.module} peak ${report.peakSimultaneous}/${report.limit}, ${raw(report.peakCurrent).toFixed(1)}A${flag}`;
}

export function describePulse(pulse: PulseWindow): string {
  return `${formatPin(pulse.event.address)} draws ${raw(pulse.draw).toFixed(2)}A`;
}
