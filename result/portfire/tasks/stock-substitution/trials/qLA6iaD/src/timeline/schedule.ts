import type { Effect } from "../catalog/effect.js";
import { ignitionTimeFor, occupancyOf, timingOf } from "../catalog/timing.js";
import type { Interval } from "../core/interval.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";
import type { Assignment } from "../rig/allocate.js";
import type { PinAddress } from "../rig/pin.js";
import { comparePins } from "../rig/pin.js";

/**
 * The firing table.
 *
 * This is the only artefact that leaves portfire and goes onto a panel, and it
 * is the point of the whole exercise. Every earlier stage exists to get here
 * with the right numbers, and every later stage exists to check that the
 * numbers are safe.
 *
 * The important column is the ignition time, not the cue time. A script says
 * when an effect should be seen; the table says when the circuit closes. For a
 * mine those are almost the same number and for a twelve inch shell they are
 * six seconds apart, which is why a table that quietly used the cue time
 * would look correct and run late.
 */

export interface FiringEvent {
  /** When the panel closes the circuit. May be negative, see pre roll. */
  readonly ignitionAt: Milliseconds;
  /** When the audience sees it, which is what the script asked for. */
  readonly visibleAt: Milliseconds;
  readonly address: PinAddress;
  readonly effectId: string;
  readonly effect: Effect;
  readonly position: string;
  readonly label?: string;
  /** The lot the shell came out of, when the show was drawn from a magazine. */
  readonly lot?: string;
  /**
   * What the script asked for, when this cue is firing a stand in. The effect
   * above is the stand in, so this is the only place the original ask survives.
   */
  readonly substitutedFor?: string;
  /** Ignition to last light out, for the density and load checks. */
  readonly occupancy: Interval;
}

export interface Schedule {
  readonly events: readonly FiringEvent[];
  /**
   * How far before the show clock the earliest event fires. Zero when nothing
   * has to go up early, positive when the panel needs a pre roll.
   */
  readonly preRoll: Milliseconds;
  /** First ignition to last light out. */
  readonly duration: Milliseconds;
}

export function buildSchedule(assignments: readonly Assignment[]): Schedule {
  const events: FiringEvent[] = [];
  for (const assignment of assignments) {
    const { shot, address } = assignment;
    const effect = shot.resolved;
    const withHeight: Effect =
      shot.height !== undefined && effect.kind === "shell"
        ? { ...effect, breakHeight: shot.height }
        : effect;
    const ignitionAt = ignitionTimeFor(withHeight, shot.at);
    events.push({
      ignitionAt,
      visibleAt: shot.at,
      address,
      effectId: shot.effect,
      effect: withHeight,
      position: shot.position,
      ...(shot.label === undefined ? {} : { label: shot.label }),
      ...(shot.lot === undefined ? {} : { lot: shot.lot }),
      ...(shot.substitutedFor === undefined
        ? {}
        : { substitutedFor: shot.substitutedFor }),
      occupancy: occupancyOf(withHeight, ignitionAt),
    });
  }
  events.sort(compareEvents);
  return {
    events,
    preRoll: preRollOf(events),
    duration: durationOf(events),
  };
}

export function compareEvents(a: FiringEvent, b: FiringEvent): number {
  const gap = raw(a.ignitionAt) - raw(b.ignitionAt);
  return gap !== 0 ? gap : comparePins(a.address, b.address);
}

function preRollOf(events: readonly FiringEvent[]): Milliseconds {
  let earliest = 0;
  for (const event of events) {
    const at = raw(event.ignitionAt);
    if (at < earliest) {
      earliest = at;
    }
  }
  // Adding zero collapses negative zero, which a show with no pre roll would
  // otherwise report and which then prints as -0 on a cue sheet.
  return ms(-earliest + 0);
}

function durationOf(events: readonly FiringEvent[]): Milliseconds {
  if (events.length === 0) {
    return ms(0);
  }
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    first = Math.min(first, raw(event.occupancy.start));
    last = Math.max(last, raw(event.occupancy.end));
  }
  return ms(last - first);
}

/** Shift every event, for a show that has to start at a different clock. */
export function shiftSchedule(schedule: Schedule, by: Milliseconds): Schedule {
  const events = schedule.events.map((event) => ({
    ...event,
    ignitionAt: ms(raw(event.ignitionAt) + raw(by)),
    visibleAt: ms(raw(event.visibleAt) + raw(by)),
    occupancy: {
      start: ms(raw(event.occupancy.start) + raw(by)),
      end: ms(raw(event.occupancy.end) + raw(by)),
    },
  }));
  return { events, preRoll: preRollOf(events), duration: schedule.duration };
}

/**
 * Move the whole show forward by its own pre roll, so nothing fires before
 * zero. A panel that cannot pre roll needs this, and the cost is that the
 * music has to start that much later.
 */
export function absorbPreRoll(schedule: Schedule): Schedule {
  return raw(schedule.preRoll) === 0
    ? schedule
    : shiftSchedule(schedule, schedule.preRoll);
}

export function eventsAt(schedule: Schedule, at: Milliseconds): FiringEvent[] {
  return schedule.events.filter(
    (event) =>
      raw(event.occupancy.start) <= raw(at) &&
      raw(at) < raw(event.occupancy.end),
  );
}

/** Events whose circuit closes inside a window, which is what a panel batches. */
export function ignitionsBetween(
  schedule: Schedule,
  from: Milliseconds,
  to: Milliseconds,
): FiringEvent[] {
  return schedule.events.filter(
    (event) =>
      raw(event.ignitionAt) >= raw(from) && raw(event.ignitionAt) < raw(to),
  );
}

/** The largest lead in the show, which is the shell that has to go up first. */
export function longestLead(schedule: Schedule): FiringEvent | undefined {
  let worst: FiringEvent | undefined;
  let worstLead = -1;
  for (const event of schedule.events) {
    const lead = raw(timingOf(event.effect).lead);
    if (lead > worstLead) {
      worstLead = lead;
      worst = event;
    }
  }
  return worst;
}

export function eventsOn(schedule: Schedule, module: number): FiringEvent[] {
  return schedule.events.filter((event) => event.address.module === module);
}

export function eventsFrom(
  schedule: Schedule,
  position: string,
): FiringEvent[] {
  return schedule.events.filter((event) => event.position === position);
}
