import { calibreOf } from "../catalog/effect.js";
import { keyValueTable, renderTable } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { metres, raw, toFeet } from "../core/units.js";
import type { Metres } from "../core/units.js";
import type { Rig } from "../rig/rig.js";
import type { DistanceRule } from "../safety/distance.js";
import { separationForEffect, worstSeparation } from "../safety/distance.js";
import { distanceToAudience } from "../safety/site.js";
import type { Site } from "../safety/site.js";
import { densityReport } from "../timeline/density.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";

/**
 * The paperwork.
 *
 * Every authority wants the same handful of facts in a different order, so
 * this produces the facts and leaves the order to whoever fills the form in.
 * What matters is that the numbers come from the same place the safety checks
 * came from. A permit filled in by hand from a different spreadsheet is the
 * classic way for an application to describe a show nobody is going to fire.
 */

export interface PermitDetails {
  readonly showName: string;
  readonly siteName: string;
  /** Date the show is to be fired, as an ISO date. */
  readonly date?: string;
  readonly operator?: string;
  readonly licenceNumber?: string;
}

export interface PermitFacts {
  readonly details: PermitDetails;
  readonly cueCount: number;
  readonly shotCount: number;
  readonly durationMs: number;
  readonly largestCalibreMm: number;
  readonly requiredSeparation: Metres;
  readonly actualSeparation: Metres;
  readonly separationRule: DistanceRule;
  readonly positions: number;
  readonly effectCounts: ReadonlyMap<string, number>;
  readonly peakLit: number;
}

export function permitFacts(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  site: Site,
  details: PermitDetails,
  rule: DistanceRule = "nfpa-1123",
): PermitFacts {
  const effectCounts = new Map<string, number>();
  let largest = 0;
  let actual = Number.POSITIVE_INFINITY;
  for (const event of schedule.events) {
    effectCounts.set(
      event.effectId,
      (effectCounts.get(event.effectId) ?? 0) + 1,
    );
    const size = calibreOf(event.effect);
    if (size !== undefined) {
      largest = Math.max(largest, raw(size.size));
    }
    const position = rig.position(event.position);
    if (position !== undefined) {
      actual = Math.min(actual, raw(distanceToAudience(position, site)));
    }
  }
  const density = densityReport(schedule);
  return {
    details,
    cueCount: schedule.events.length,
    shotCount: schedule.events.length,
    durationMs: Math.round(raw(schedule.duration)),
    largestCalibreMm: largest,
    requiredSeparation: worstSeparation(
      schedule.events.map((event) => event.effect),
      rule,
    ),
    actualSeparation: metres(Number.isFinite(actual) ? actual : 0),
    separationRule: rule,
    positions: new Set(schedule.events.map((event) => event.position)).size,
    effectCounts,
    peakLit: density.peak,
  };
}

/** Whether the site as described satisfies the rule it is described under. */
export function permitClears(facts: PermitFacts): boolean {
  return (
    facts.cueCount === 0 ||
    raw(facts.actualSeparation) >= raw(facts.requiredSeparation)
  );
}

function line(label: string, value: string): [string, string] {
  return [label, value];
}

export function permitSummary(facts: PermitFacts): string {
  const rows: [string, string][] = [
    line("show", facts.details.showName),
    line("site", facts.details.siteName),
  ];
  if (facts.details.date !== undefined) {
    rows.push(line("date", facts.details.date));
  }
  if (facts.details.operator !== undefined) {
    rows.push(line("operator", facts.details.operator));
  }
  if (facts.details.licenceNumber !== undefined) {
    rows.push(line("licence", facts.details.licenceNumber));
  }
  rows.push(
    line("shots", String(facts.shotCount)),
    line("firing positions", String(facts.positions)),
    line("duration", `${(facts.durationMs / 1000).toFixed(1)}s`),
    line(
      "largest calibre",
      facts.largestCalibreMm === 0
        ? "none"
        : `${facts.largestCalibreMm.toFixed(0)}mm`,
    ),
    line("separation rule", facts.separationRule),
    line(
      "separation required",
      `${raw(facts.requiredSeparation).toFixed(0)}m (${toFeet(facts.requiredSeparation).toFixed(0)}ft)`,
    ),
    line(
      "separation available",
      `${raw(facts.actualSeparation).toFixed(0)}m (${toFeet(facts.actualSeparation).toFixed(0)}ft)`,
    ),
    line("peak effects lit", String(facts.peakLit)),
    line("clears the rule", permitClears(facts) ? "yes" : "no"),
  );
  return keyValueTable(rows, ["item", "value"]);
}

/** The shot list an authority asks for, one row per effect with its distance. */
export function permitShotList(
  schedule: Schedule | QuantisedSchedule,
  rule: DistanceRule = "nfpa-1123",
): string {
  const byEffect = new Map<
    string,
    { count: number; calibre: number; separation: number }
  >();
  for (const event of schedule.events) {
    const held = byEffect.get(event.effectId);
    if (held !== undefined) {
      held.count += 1;
      continue;
    }
    const size = calibreOf(event.effect);
    byEffect.set(event.effectId, {
      count: 1,
      calibre: size === undefined ? 0 : raw(size.size),
      separation: raw(separationForEffect(event.effect, rule)),
    });
  }
  const rows = [...byEffect.entries()]
    .sort((a, b) => b[1].calibre - a[1].calibre || a[0].localeCompare(b[0]))
    .map(([effectId, held]) => [
      effectId,
      String(held.count),
      held.calibre === 0 ? "ground" : `${held.calibre.toFixed(0)}mm`,
      `${held.separation.toFixed(0)}m`,
    ]);
  return renderTable(
    [
      { header: "effect" },
      { header: "count", align: "right" },
      { header: "calibre", align: "right" },
      { header: "separation", align: "right" },
    ],
    rows,
  );
}

/**
 * Which lots the show fires from, for the record an inspector asks for after
 * a shell misbehaves. Only a show drawn from a magazine has one; a permit
 * for a show that was never drawn says nothing about lots rather than
 * printing an empty table.
 */
export function permitLots(schedule: Schedule | QuantisedSchedule): string {
  const byLot = new Map<string, Map<string, number>>();
  for (const event of schedule.events) {
    if (event.lot === undefined) {
      continue;
    }
    const held = byLot.get(event.lot) ?? new Map<string, number>();
    held.set(event.effectId, (held.get(event.effectId) ?? 0) + 1);
    byLot.set(event.lot, held);
  }
  if (byLot.size === 0) {
    return "not drawn from a magazine";
  }
  const rows: string[][] = [];
  for (const [lot, effects] of [...byLot.entries()].sort()) {
    for (const [effectId, count] of [...effects.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      rows.push([lot, effectId, String(count)]);
    }
  }
  return renderTable(
    [
      { header: "lot" },
      { header: "effect" },
      { header: "count", align: "right" },
    ],
    rows,
  );
}

/** A timing note for the licence, which usually asks for start and finish. */
export function permitTiming(schedule: Schedule | QuantisedSchedule): string {
  const events = schedule.events;
  const first = events[0];
  const last = events[events.length - 1];
  if (first === undefined || last === undefined) {
    return "no cues";
  }
  return [
    `first ignition ${formatShowTime(first.ignitionAt)}`,
    `last ignition ${formatShowTime(last.ignitionAt)}`,
    `runs ${(raw(schedule.duration) / 1000).toFixed(1)}s`,
  ].join("\n");
}

export function permitDocument(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  site: Site,
  details: PermitDetails,
  rule: DistanceRule = "nfpa-1123",
): string {
  const facts = permitFacts(schedule, rig, site, details, rule);
  return [
    `${details.showName} at ${details.siteName}`,
    "",
    permitSummary(facts),
    "",
    "shot list",
    "",
    permitShotList(schedule, rule),
    "",
    "timing",
    "",
    permitTiming(schedule),
    ...(schedule.events.some((event) => event.lot !== undefined)
      ? ["", "lots", "", permitLots(schedule)]
      : []),
  ].join("\n");
}
