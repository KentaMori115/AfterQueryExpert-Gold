import { describeEffect } from "../catalog/effect.js";
import type { DrawResult } from "../catalog/draw.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import { formatPin } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";
import { densityReport } from "../timeline/density.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import { driftReport } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";

/**
 * The machine readable form.
 *
 * Somebody always wants to feed a show into something else, whether that is a
 * lighting desk, a spreadsheet, or a script that counts shells for an
 * insurance form. This is that door, and the important thing about it is the
 * version number, because the moment anybody parses this outside portfire the
 * shape stops being free to change.
 *
 * Times are milliseconds as integers. Not seconds, because a float second
 * loses the frame boundary; not formatted strings, because the consumer would
 * have to parse them back.
 */

export const SHOW_JSON_VERSION = 1;

export interface JsonEvent {
  readonly cue: number;
  readonly ignitionMs: number;
  readonly visibleMs: number;
  readonly address: string;
  readonly module: number;
  readonly pin: number;
  readonly effect: string;
  readonly description: string;
  readonly position: string;
  readonly label?: string;
  /** The magazine lot drawn, when the show was compiled against stock. */
  readonly lot?: string;
  /** What the script asked for, when a stand-in fires instead. */
  readonly substitutedFor?: string;
  readonly occupancyMs: readonly [number, number];
}

export interface JsonRigPosition {
  readonly id: string;
  readonly east: number;
  readonly north: number;
  readonly modules: readonly number[];
}

export interface JsonShow {
  readonly version: number;
  readonly name: string;
  readonly frameRate: number;
  readonly dropFrame: boolean;
  readonly preRollMs: number;
  readonly durationMs: number;
  readonly cueCount: number;
  readonly events: readonly JsonEvent[];
  readonly positions?: readonly JsonRigPosition[];
  /** What was drawn from the magazine, when the show was compiled against one. */
  readonly stock?: JsonStock;
  readonly summary: {
    readonly peakLit: number;
    readonly peakLitAtMs: number;
    readonly litMs: number;
    readonly worstDriftMs: number;
    readonly lulls: number;
  };
}

export interface JsonStock {
  /** Asked-for effect, the stand-in, and how many shots it covers. */
  readonly covers: readonly {
    readonly asked: string;
    readonly used: string;
    readonly shots: number;
    readonly match: "exact" | "near";
  }[];
  /** Effects with shots nothing could cover, and how many. */
  readonly short: readonly {
    readonly effect: string;
    readonly shots: number;
  }[];
  /** Units drawn from each lot, in lot order. */
  readonly lots: readonly { readonly lot: string; readonly drawn: number }[];
}

export interface JsonOptions {
  readonly name?: string;
  /** Include the rig's geometry, for a consumer drawing a site plan. */
  readonly rig?: Rig;
  /** The draw behind the schedule, for a consumer reconciling the book. */
  readonly stock?: DrawResult;
}

function toJsonStock(stock: DrawResult): JsonStock {
  return {
    covers: stock.covers.map((cover) => ({
      asked: cover.asked,
      used: cover.used,
      shots: cover.count,
      match: cover.quality,
    })),
    short: stock.short.map((line) => ({
      effect: line.effectId,
      shots: line.uncovered,
    })),
    lots: [...stock.drawn.entries()].map(([lot, drawn]) => ({ lot, drawn })),
  };
}

export function toJsonShow(
  schedule: QuantisedSchedule,
  options: JsonOptions = {},
): JsonShow {
  const density = densityReport(schedule);
  const drift = driftReport(schedule);
  const events: JsonEvent[] = schedule.events.map((event, index) => ({
    cue: index + 1,
    ignitionMs: Math.round(raw(event.ignitionAt)),
    visibleMs: Math.round(raw(event.visibleAt)),
    address: formatPin(event.address),
    module: event.address.module,
    pin: event.address.pin,
    effect: event.effectId,
    description: describeEffect(event.effect),
    position: event.position,
    ...(event.label === undefined ? {} : { label: event.label }),
    ...(event.lot === undefined ? {} : { lot: event.lot }),
    ...(event.substitutedFor === undefined
      ? {}
      : { substitutedFor: event.substitutedFor }),
    occupancyMs: [
      Math.round(raw(event.occupancy.start)),
      Math.round(raw(event.occupancy.end)),
    ] as const,
  }));

  const positions = options.rig?.positionIds().map((id) => {
    const spot = options.rig?.position(id);
    return {
      id,
      east: spot?.east ?? 0,
      north: spot?.north ?? 0,
      modules: (options.rig?.modulesAt(id) ?? []).map((unit) => unit.number),
    };
  });

  return {
    version: SHOW_JSON_VERSION,
    name: options.name ?? "show",
    frameRate: schedule.format.rate,
    dropFrame: schedule.format.dropFrame,
    preRollMs: Math.round(raw(schedule.preRoll)),
    durationMs: Math.round(raw(schedule.duration)),
    cueCount: events.length,
    events,
    ...(positions === undefined ? {} : { positions }),
    ...(options.stock === undefined
      ? {}
      : { stock: toJsonStock(options.stock) }),
    summary: {
      peakLit: density.peak,
      peakLitAtMs: Math.round(raw(density.peakAt)),
      litMs: Math.round(raw(density.litTime)),
      worstDriftMs: Number(drift.worst.toFixed(3)),
      lulls: density.lulls.length,
    },
  };
}

export function writeShowJson(
  schedule: QuantisedSchedule,
  options: JsonOptions = {},
  pretty = true,
): string {
  return JSON.stringify(toJsonShow(schedule, options), null, pretty ? 2 : 0);
}

/**
 * Read a show back. This does not rebuild a schedule, because a schedule
 * depends on a catalog the file does not carry. It gives back the file as it
 * was written, having checked the version and the shape, which is what a
 * consumer wanting the cue list actually needs.
 */
export function readShowJson(text: string): JsonShow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const value = parsed as Partial<JsonShow>;
  if (value.version !== SHOW_JSON_VERSION || !Array.isArray(value.events)) {
    return undefined;
  }
  return value as JsonShow;
}

/** A one line description, for a consumer listing several shows. */
export function describeJsonShow(show: JsonShow): string {
  const seconds = (show.durationMs / 1000).toFixed(1);
  return `${show.name}, ${show.cueCount} cues, ${seconds}s, ${show.frameRate}fps`;
}

/** Cue numbers whose break falls inside a window, for a consumer's query. */
export function cuesBetween(
  show: JsonShow,
  fromMs: number,
  toMs: number,
): number[] {
  return show.events
    .filter((event) => event.visibleMs >= fromMs && event.visibleMs < toMs)
    .map((event) => event.cue);
}

/** The cue list as plain lines, for a consumer that cannot parse json. */
export function jsonShowLines(show: JsonShow): string[] {
  return show.events.map(
    (event) =>
      `${event.cue} ${formatShowTime(ms(event.ignitionMs))} ${event.address} ${event.effect}`,
  );
}

/** Schedules from before quantisation carry no format, so this is the door. */
export function isQuantised(
  schedule: Schedule | QuantisedSchedule,
): schedule is QuantisedSchedule {
  return "format" in schedule;
}
