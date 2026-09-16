import type { DistanceRule } from "./distance.js";
import { separationForEffect } from "./distance.js";
import type { Site } from "./site.js";
import { clearances, distanceToAudience, falloutClears } from "./site.js";
import type { Wind } from "./wind.js";
import { driftDistance, windVerdict } from "./wind.js";
import { envelopeOf, ceilingOf } from "../catalog/envelope.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { Metres } from "../core/units.js";
import { metres, raw } from "../core/units.js";
import type { Rig } from "../rig/rig.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";

/**
 * The checks that decide whether a show can be fired.
 *
 * Everything here is a rule that a competent shooter would apply from a site
 * plan and a shot list, done automatically and applied to every cue rather
 * than to the worst one. That difference matters. A crew checks the largest
 * shell against the tightest position and calls it done, and the mistake that
 * gets through is the ordinary six inch on the rack nobody thought about,
 * because that rack is fifteen metres closer than the one they measured.
 *
 * Separation and airspace are errors. Wind and fallout margins are warnings
 * unless they are actually breached, because both depend on a forecast that
 * will have changed by the time the show fires.
 */

export interface SafetyContext {
  readonly site: Site;
  readonly rig: Rig;
  readonly rule?: DistanceRule;
  readonly wind?: Wind;
  /** Hard ceiling from an airspace restriction, in metres above ground. */
  readonly ceiling?: Metres;
}

export interface SeparationFinding {
  readonly position: string;
  readonly effectId: string;
  readonly needed: Metres;
  readonly available: Metres;
}

export function separationFindings(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): SeparationFinding[] {
  const worstByPair = new Map<string, SeparationFinding>();
  for (const event of schedule.events) {
    const position = context.rig.position(event.position);
    if (position === undefined) {
      continue;
    }
    const needed = separationForEffect(event.effect, context.rule);
    const available = distanceToAudience(position, context.site);
    if (raw(available) >= raw(needed)) {
      continue;
    }
    const key = `${event.position}|${event.effectId}`;
    const existing = worstByPair.get(key);
    if (existing === undefined || raw(needed) > raw(existing.needed)) {
      worstByPair.set(key, {
        position: event.position,
        effectId: event.effectId,
        needed,
        available,
      });
    }
  }
  return [...worstByPair.values()].sort(
    (a, b) =>
      raw(b.needed) - raw(b.available) - (raw(a.needed) - raw(a.available)),
  );
}

export function checkSeparation(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const finding of separationFindings(schedule, context)) {
    diagnostics.error({
      code: "PF4100",
      message: `${finding.effectId} from ${finding.position} wants ${raw(finding.needed).toFixed(0)}m and has ${raw(finding.available).toFixed(0)}m`,
      help: "move the position back, drop the calibre, or move the audience line",
    });
  }
  return diagnostics;
}

export function checkAirspace(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const ceiling = context.ceiling;
  if (ceiling === undefined) {
    return diagnostics;
  }
  const worst = new Map<string, Metres>();
  for (const event of schedule.events) {
    const top = ceilingOf(envelopeOf(event.effect));
    if (raw(top) > raw(ceiling)) {
      const held = worst.get(event.effectId);
      if (held === undefined || raw(top) > raw(held)) {
        worst.set(event.effectId, top);
      }
    }
  }
  for (const [effectId, top] of [...worst.entries()].sort()) {
    diagnostics.error({
      code: "PF4101",
      message: `${effectId} reaches ${raw(top).toFixed(0)}m through a ${raw(ceiling).toFixed(0)}m ceiling`,
      help: "lower the break with a height clause, or drop the calibre",
    });
  }
  return diagnostics;
}

export function checkFallout(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const seen = new Set<string>();
  for (const event of schedule.events) {
    const position = context.rig.position(event.position);
    if (position === undefined) {
      continue;
    }
    const envelope = envelopeOf(event.effect);
    const drift =
      context.wind === undefined
        ? metres(0)
        : driftDistance(envelope.centreHeight, context.wind);
    const radius = metres(raw(envelope.falloutRadius) + raw(drift));
    for (const crossed of falloutClears(position, context.site, radius)) {
      const key = `${event.position}|${crossed}|${event.effectId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      diagnostics.error({
        code: "PF4102",
        message: `fallout from ${event.effectId} at ${event.position} reaches the ${crossed}`,
        help: "this is a hard boundary, nothing may land past it",
      });
    }
  }
  return diagnostics;
}

/** The tightest margin on the site, for the one line a permit asks for. */
export function tightestMargin(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): number {
  let tightest = Number.POSITIVE_INFINITY;
  for (const event of schedule.events) {
    const position = context.rig.position(event.position);
    if (position === undefined) {
      continue;
    }
    const needed = raw(separationForEffect(event.effect, context.rule));
    const available = raw(distanceToAudience(position, context.site));
    tightest = Math.min(tightest, available - needed);
  }
  return Number.isFinite(tightest) ? tightest : 0;
}

export interface SafetyVerdict {
  readonly ok: boolean;
  readonly diagnostics: DiagnosticBag;
  readonly tightestMargin: number;
  readonly wind: ReturnType<typeof windVerdict> | undefined;
}

export function checkSafety(
  schedule: Schedule | QuantisedSchedule,
  context: SafetyContext,
): SafetyVerdict {
  const diagnostics = new DiagnosticBag()
    .addAll(checkSeparation(schedule, context).all())
    .addAll(checkAirspace(schedule, context).all())
    .addAll(checkFallout(schedule, context).all());
  if (context.wind !== undefined && windVerdict(context.wind) === "hold") {
    diagnostics.error({
      code: "PF4103",
      message: `the wind is at the hold speed, nothing fires`,
    });
  }
  return {
    ok: !diagnostics.hasErrors(),
    diagnostics,
    tightestMargin: tightestMargin(schedule, context),
    wind: context.wind === undefined ? undefined : windVerdict(context.wind),
  };
}

/** Every position with the boundary it is closest to, for the site sheet. */
export function siteSummary(context: SafetyContext): string[] {
  return context.rig.allModules().length === 0
    ? []
    : context.rig.positionIds().map((id) => {
        const position = context.rig.position(id);
        if (position === undefined) {
          return `${id}: not placed`;
        }
        const nearest = clearances(position, context.site)[0];
        return nearest === undefined
          ? `${id}: no boundaries`
          : `${id}: ${raw(nearest.distance).toFixed(0)}m to the ${nearest.boundary}`;
      });
}
