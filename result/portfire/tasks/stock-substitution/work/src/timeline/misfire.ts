import type { QuantisedSchedule } from "./quantise.js";
import type { FiringEvent, Schedule } from "./schedule.js";
import { isGround } from "../catalog/effect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { formatShowTime } from "../core/timecode.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";
import type { PinAddress } from "../rig/pin.js";
import { formatPin, pinKey } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";

/**
 * What happens after a cue does not go.
 *
 * A misfire is not a bug in the show, it is an ordinary event, and the part
 * that goes wrong is what happens next. Somebody walks out to a mortar that
 * did not fire, and either it is genuinely dead or it is a hangfire that is
 * still thinking about it. The waiting period exists because the second case
 * is indistinguishable from the first from twenty metres away.
 *
 * The waiting periods here are the conservative ones. Thirty minutes before
 * anybody approaches a mortar with a shell still in it, five minutes for a
 * ground piece with nothing under pressure. No code should ever shorten these,
 * so they are constants rather than options.
 */

/** Nobody approaches a loaded mortar inside this. */
export const MORTAR_WAIT: Milliseconds = ms(30 * 60 * 1000);

/** A ground piece with no lift charge under it. */
export const GROUND_WAIT: Milliseconds = ms(5 * 60 * 1000);

export interface Misfire {
  readonly address: PinAddress;
  readonly event: FiringEvent;
  /** When it should have fired, for the incident log. */
  readonly expectedAt: Milliseconds;
}

export function misfiresIn(
  schedule: Schedule | QuantisedSchedule,
  failed: Iterable<PinAddress>,
): Misfire[] {
  const wanted = new Set([...failed].map(pinKey));
  return schedule.events
    .filter((event) => wanted.has(pinKey(event.address)))
    .map((event) => ({
      address: event.address,
      event,
      expectedAt: event.ignitionAt,
    }));
}

/** How long before anybody may walk out to a given misfire. */
export function waitFor(misfire: Misfire): Milliseconds {
  return isGround(misfire.event.effect) ? GROUND_WAIT : MORTAR_WAIT;
}

/**
 * The moment the last misfire becomes approachable, counted from the end of
 * the show rather than from each cue. A crew clears the field once.
 */
export function clearAt(
  schedule: Schedule | QuantisedSchedule,
  misfires: readonly Misfire[],
): Milliseconds {
  if (misfires.length === 0) {
    return ms(0);
  }
  let latest = 0;
  for (const event of schedule.events) {
    latest = Math.max(latest, raw(event.occupancy.end));
  }
  let wait = 0;
  for (const misfire of misfires) {
    wait = Math.max(wait, raw(waitFor(misfire)));
  }
  return ms(latest + wait);
}

export interface RefirePlan {
  readonly misfire: Misfire;
  /** A free pin at the same position, when the rig has one. */
  readonly spare?: PinAddress;
  readonly reason?: string;
}

/**
 * Where each misfire could be moved to for a second attempt. A shell that did
 * not go is normally not refired at all, so this exists for the rehearsal
 * case and for ground pieces, which are routinely relit.
 */
export function planRefires(
  schedule: Schedule | QuantisedSchedule,
  misfires: readonly Misfire[],
  rig: Rig,
): RefirePlan[] {
  const taken = new Set(schedule.events.map((event) => pinKey(event.address)));
  const plans: RefirePlan[] = [];
  for (const misfire of misfires) {
    if (!isGround(misfire.event.effect)) {
      plans.push({
        misfire,
        reason: "a shell that did not lift is not refired, it is made safe",
      });
      continue;
    }
    const spare = rig.nextFreePinAt(misfire.event.position, taken);
    if (spare === undefined) {
      plans.push({
        misfire,
        reason: `no free pin left at ${misfire.event.position}`,
      });
      continue;
    }
    taken.add(pinKey(spare));
    plans.push({ misfire, spare });
  }
  return plans;
}

export function checkMisfires(
  schedule: Schedule | QuantisedSchedule,
  misfires: readonly Misfire[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  if (misfires.length === 0) {
    return diagnostics;
  }
  const clear = clearAt(schedule, misfires);
  diagnostics.warning({
    code: "PF3400",
    message: `${misfires.length} cues did not fire`,
    help: `nobody approaches before ${formatShowTime(clear)} on the show clock`,
  });
  for (const misfire of misfires) {
    diagnostics.note({
      code: "PF3401",
      message: `${formatPin(misfire.address)} ${misfire.event.effectId} at ${misfire.event.position} was due at ${formatShowTime(misfire.expectedAt)}`,
    });
  }
  return diagnostics;
}

/** A line per misfire for the incident book, sorted for a legible record. */
export function incidentLines(misfires: readonly Misfire[]): string[] {
  return [...misfires]
    .sort((a, b) => {
      const gap = raw(a.expectedAt) - raw(b.expectedAt);
      return gap !== 0 ? gap : compareIds(a.event.effectId, b.event.effectId);
    })
    .map(
      (misfire) =>
        `${formatShowTime(misfire.expectedAt)}  ${formatPin(misfire.address)}  ${misfire.event.effectId}  ${misfire.event.position}  wait ${(raw(waitFor(misfire)) / 60000).toFixed(0)} minutes`,
    );
}

/** How many of a show's cues did not go, as a fraction. */
export function misfireRate(
  schedule: Schedule | QuantisedSchedule,
  misfires: readonly Misfire[],
): number {
  return schedule.events.length === 0
    ? 0
    : misfires.length / schedule.events.length;
}
