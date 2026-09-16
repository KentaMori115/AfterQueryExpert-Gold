import { writeCsv } from "../core/csv.js";
import {
  formatShowTime,
  msToTimecode,
  formatTimecode,
} from "../core/timecode.js";
import type { TimecodeFormat } from "../core/timecode.js";
import { raw } from "../core/units.js";
import { formatPin, pinIndex } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { FiringEvent, Schedule } from "../timeline/schedule.js";

/**
 * The file that goes on the panel's memory card.
 *
 * Every panel wants something slightly different and none of them document it
 * properly, so this writes the intersection that all of them import: one row
 * per cue, a time, an address, and a description nobody's firmware parses.
 * The variations are in the address column and in whether the time is elapsed
 * or timecode, so those are the two things this can change.
 *
 * The description column is for the person, not the panel. It is the only
 * thing a shooter has to go on when a cue misfires and they are standing on a
 * field with a torch trying to work out what was supposed to happen.
 */

export type AddressStyle = "dotted" | "flat" | "module-pin";
export type TimeStyle = "elapsed" | "timecode" | "milliseconds";

export interface FiringTableOptions {
  readonly addressStyle?: AddressStyle;
  readonly timeStyle?: TimeStyle;
  readonly format?: TimecodeFormat;
  /** Pins per module, needed only by the flat address style. */
  readonly pinsPerModule?: number;
  readonly includeHeader?: boolean;
}

function addressOf(
  event: FiringEvent,
  style: AddressStyle,
  pinsPerModule: number,
): string {
  switch (style) {
    case "dotted":
      return formatPin(event.address);
    case "flat":
      return String(pinIndex(event.address, pinsPerModule) + 1);
    case "module-pin":
      return `${event.address.module},${event.address.pin}`;
  }
}

function timeOf(
  event: FiringEvent,
  style: TimeStyle,
  format: TimecodeFormat,
): string {
  switch (style) {
    case "elapsed":
      return formatShowTime(event.ignitionAt);
    case "milliseconds":
      return String(Math.round(raw(event.ignitionAt)));
    case "timecode":
      return formatTimecode(msToTimecode(event.ignitionAt, format), format);
  }
}

const HEADERS = ["cue", "time", "address", "effect", "position", "note"];

export function firingTableRows(
  schedule: Schedule | QuantisedSchedule,
  options: FiringTableOptions = {},
): string[][] {
  const addressStyle = options.addressStyle ?? "dotted";
  const timeStyle = options.timeStyle ?? "elapsed";
  const format = options.format ?? { rate: 25 as const, dropFrame: false };
  const pinsPerModule = options.pinsPerModule ?? 32;
  return schedule.events.map((event, index) => [
    String(index + 1),
    timeOf(event, timeStyle, format),
    addressOf(event, addressStyle, pinsPerModule),
    event.effectId,
    event.position,
    event.label ?? "",
  ]);
}

export function firingTableCsv(
  schedule: Schedule | QuantisedSchedule,
  options: FiringTableOptions = {},
): string {
  const rows = firingTableRows(schedule, options);
  const all = (options.includeHeader ?? true) ? [[...HEADERS], ...rows] : rows;
  return writeCsv(all);
}

/**
 * Pins per module for a rig where every module is the same. A mixed rig has no
 * single answer, so the flat address style refuses rather than guessing.
 */
export function uniformPinsPerModule(rig: Rig): number | undefined {
  const models = rig.modelsInUse();
  const first = models[0];
  if (first === undefined) {
    return undefined;
  }
  return models.every((model) => model.pins === first.pins)
    ? first.pins
    : undefined;
}

export interface TableCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/** Whether a style can be written for this rig at all. */
export function canWrite(rig: Rig, style: AddressStyle): TableCheck {
  if (style !== "flat") {
    return { ok: true };
  }
  return uniformPinsPerModule(rig) === undefined
    ? {
        ok: false,
        reason:
          "a flat address needs every module to have the same pin count, and this rig mixes models",
      }
    : { ok: true };
}

/** The panel's own row count, which some firmware caps. */
export function rowCount(schedule: Schedule | QuantisedSchedule): number {
  return schedule.events.length;
}
