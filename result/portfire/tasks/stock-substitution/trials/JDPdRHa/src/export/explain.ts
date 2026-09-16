import { describeEffect, calibreOf, isAerial } from "../catalog/effect.js";
import { describeEnvelope, envelopeOf } from "../catalog/envelope.js";
import { classFor, netExplosiveGrams } from "../catalog/hazard.js";
import { IGNITION_DELAY, apogeeFor, riseTimeFor } from "../catalog/lift.js";
import { timingOf } from "../catalog/timing.js";
import { keyValueTable, renderTable } from "../core/text.js";
import {
  formatShowTime,
  msToTimecode,
  formatTimecode,
} from "../core/timecode.js";
import { raw } from "../core/units.js";
import { formatPin, labelPin } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";
import { separationForEffect } from "../safety/distance.js";
import type { DistanceRule } from "../safety/distance.js";
import type {
  QuantisedEvent,
  QuantisedSchedule,
} from "../timeline/quantise.js";

/**
 * Why one cue is the way it is.
 *
 * The compiler makes a lot of decisions per cue and most of them are invisible
 * in the firing table, which is one row of numbers. When somebody asks why cue
 * 214 fires four seconds before the beat it lands on, this is the answer, and
 * having it in the tool rather than in somebody's head is what stops the
 * answer being a guess.
 */

export interface ExplainOptions {
  readonly rig?: Rig;
  readonly rule?: DistanceRule;
}

export function findEvent(
  schedule: QuantisedSchedule,
  wanted: string,
): QuantisedEvent | undefined {
  const asNumber = Number(wanted);
  if (Number.isInteger(asNumber) && asNumber >= 1) {
    return schedule.events[asNumber - 1];
  }
  return schedule.events.find(
    (event) =>
      formatPin(event.address) === wanted ||
      labelPin(event.address) === wanted ||
      event.label === wanted,
  );
}

function timingRows(event: QuantisedEvent): [string, string][] {
  const timing = timingOf(event.effect);
  const rows: [string, string][] = [
    ["cue asks for a break at", formatShowTime(event.visibleAt)],
  ];
  if (isAerial(event.effect)) {
    rows.push([
      "climb from the mortar",
      `${(raw(riseTimeFor(event.effect.calibre)) / 1000).toFixed(2)}s`,
    ]);
  }
  rows.push(
    ["match and quickmatch", `${raw(IGNITION_DELAY)}ms`],
    ["so the panel fires at", formatShowTime(event.ignitionAt)],
    ["last light out at", formatShowTime(event.occupancy.end)],
    ["total lead", `${(raw(timing.lead) / 1000).toFixed(2)}s`],
  );
  return rows;
}

export function explainEvent(
  event: QuantisedEvent,
  schedule: QuantisedSchedule,
  options: ExplainOptions = {},
): string {
  const blocks: string[] = [];
  const index = schedule.events.indexOf(event) + 1;

  blocks.push(
    `cue ${index}, ${event.effectId} from ${event.position} on ${formatPin(event.address)}`,
  );
  blocks.push(
    keyValueTable([
      ["effect", describeEffect(event.effect)],
      // Both lines only appear on a show drawn against a book. The lot is what
      // the crew reads off the case, and the cue asked for is the question
      // somebody standing at the rack is actually asking when the label on the
      // shell is not the label on the script.
      ...(event.substitutedFor === undefined
        ? []
        : ([["stands in for", event.substitutedFor]] as [string, string][])),
      ...(event.lot === undefined
        ? []
        : ([["lot", event.lot]] as [string, string][])),
      ["label", event.label ?? "none"],
      ["lead label", labelPin(event.address)],
      [
        "timecode",
        formatTimecode(
          msToTimecode(event.ignitionAt, schedule.format),
          schedule.format,
        ),
      ],
    ]),
  );

  blocks.push("timing");
  blocks.push(keyValueTable(timingRows(event), ["step", "value"]));

  const envelope = envelopeOf(event.effect);
  const size = calibreOf(event.effect);
  const hazard = classFor(event.effect);
  const safetyRows: [string, string][] = [
    ["envelope", describeEnvelope(envelope)],
    [
      "separation",
      `${raw(separationForEffect(event.effect, options.rule)).toFixed(0)}m under ${options.rule ?? "nfpa-1123"}`,
    ],
    ["hazard", `${hazard.unNumber} ${hazard.division}`],
    ["net explosive", `${netExplosiveGrams(event.effect)}g`],
  ];
  if (size !== undefined) {
    safetyRows.unshift([
      "calibre",
      `${raw(size.size).toFixed(0)}mm, apogee ${raw(apogeeFor(size)).toFixed(0)}m`,
    ]);
  }
  blocks.push("safety");
  blocks.push(keyValueTable(safetyRows));

  const rig = options.rig;
  if (rig !== undefined) {
    const unit = rig.module(event.address.module);
    const spot = rig.position(event.position);
    blocks.push("rig");
    blocks.push(
      keyValueTable([
        [
          "module",
          unit === undefined
            ? "not in this rig"
            : `${unit.number} (${unit.model.name}) at ${unit.position}`,
        ],
        [
          "position",
          spot === undefined
            ? "not in this rig"
            : `${spot.east}m east, ${spot.north}m north`,
        ],
        [
          "module limit",
          unit === undefined
            ? "unknown"
            : `${unit.model.simultaneous} outputs at once, ${unit.model.pulseMs}ms pulse`,
        ],
      ]),
    );
  }

  return blocks.join("\n\n");
}

/** Everything that fires within a window of one cue, for the context view. */
export function neighboursOf(
  event: QuantisedEvent,
  schedule: QuantisedSchedule,
  windowMs = 1000,
): QuantisedEvent[] {
  return schedule.events.filter(
    (other) =>
      other !== event &&
      Math.abs(raw(other.ignitionAt) - raw(event.ignitionAt)) <= windowMs,
  );
}

export function explainNeighbours(
  event: QuantisedEvent,
  schedule: QuantisedSchedule,
  windowMs = 1000,
): string {
  const near = neighboursOf(event, schedule, windowMs);
  if (near.length === 0) {
    return "nothing else fires within a second of this cue";
  }
  return renderTable(
    [
      { header: "fires", align: "right" },
      { header: "pin" },
      { header: "effect" },
      { header: "position" },
    ],
    near.map((other) => [
      formatShowTime(other.ignitionAt),
      formatPin(other.address),
      other.effectId,
      other.position,
    ]),
  );
}
