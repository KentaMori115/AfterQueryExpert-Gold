import { describeEffect } from "../catalog/effect.js";
import { groupBy, sortedEntries } from "../core/collect.js";
import { renderTable } from "../core/text.js";
import type { Column } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { raw } from "../core/units.js";
import { formatPin, labelPin } from "../rig/pin.js";
import type { Rig } from "../rig/rig.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { FiringEvent, Schedule } from "../timeline/schedule.js";

/**
 * The paper that goes onto the field.
 *
 * Two sheets, and they are sorted differently on purpose. The cue sheet is in
 * firing order and is what somebody follows during the show. The wiring sheet
 * is in pin order and is what the crew works from during the load, walking one
 * module at a time with a roll of lead and a marker.
 *
 * Sorting either of them the other way is a real mistake rather than a
 * preference. A crew wiring in firing order walks the field once per cue.
 */

/**
 * The cue sheet's columns, each with the cell it prints. Keeping the two
 * together means a column cannot be dropped and leave its values behind, which
 * is what happened when the break column was optional and the rows were sliced
 * by hand.
 */
interface CueColumn {
  readonly column: Column;
  readonly cell: (event: FiringEvent, index: number) => string;
}

const CUE_COLUMNS: readonly CueColumn[] = [
  {
    column: { header: "cue", align: "right" },
    cell: (_event, index) => String(index + 1),
  },
  {
    column: { header: "fire", align: "right" },
    cell: (event) => formatShowTime(event.ignitionAt),
  },
  {
    column: { header: "break", align: "right" },
    cell: (event) => formatShowTime(event.visibleAt),
  },
  { column: { header: "pin" }, cell: (event) => formatPin(event.address) },
  { column: { header: "position" }, cell: (event) => event.position },
  {
    column: { header: "effect", maxWidth: 28 },
    cell: (event) => describeEffect(event.effect),
  },
  { column: { header: "lot" }, cell: (event) => event.lot ?? "" },
  {
    column: { header: "note", maxWidth: 20 },
    cell: (event) => event.label ?? "",
  },
];

export interface SheetOptions {
  /** Print the break time as well as the ignition time. */
  readonly showBreak?: boolean;
  /**
   * Print the lot each shell came out of. On by default once the show was drawn
   * from a magazine, because a crew loading against a book wants the lot beside
   * the cue rather than in a second document, and off otherwise so a show
   * compiled without stock does not grow an empty column.
   */
  readonly showLot?: boolean;
  readonly title?: string;
}

export function cueSheet(
  schedule: Schedule | QuantisedSchedule,
  options: SheetOptions = {},
): string {
  const showBreak = options.showBreak ?? true;
  const showLot =
    options.showLot ?? schedule.events.some((event) => event.lot !== undefined);
  const chosen = CUE_COLUMNS.filter(
    (entry) =>
      (entry.column.header !== "break" || showBreak) &&
      (entry.column.header !== "lot" || showLot),
  );
  const table = renderTable(
    chosen.map((entry) => entry.column),
    schedule.events.map((event, index) =>
      chosen.map((entry) => entry.cell(event, index)),
    ),
  );
  return options.title === undefined ? table : `${options.title}\n\n${table}`;
}

const WIRING_COLUMNS: readonly Column[] = [
  { header: "pin" },
  { header: "label" },
  { header: "fire", align: "right" },
  { header: "effect", maxWidth: 28 },
];

/**
 * One block per module, pins in order, with every pin listed whether it is
 * used or not. The empty rows are the point. A crew ticking off a sheet needs
 * to see that pin 17 is deliberately unused rather than wonder whether the
 * sheet is short.
 */
export function wiringSheet(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  options: SheetOptions = {},
): string {
  const byPin = new Map<string, FiringEvent>();
  for (const event of schedule.events) {
    byPin.set(formatPin(event.address), event);
  }
  const blocks: string[] = [];
  for (const unit of rig.allModules()) {
    const rows: string[][] = [];
    for (let pin = 1; pin <= unit.model.pins; pin += 1) {
      const address = { module: unit.number, pin };
      const key = formatPin(address);
      const event = byPin.get(key);
      rows.push([
        key,
        labelPin(address),
        event === undefined ? "" : formatShowTime(event.ignitionAt),
        event === undefined ? "" : describeEffect(event.effect),
      ]);
    }
    const used = rows.filter((row) => row[3] !== "").length;
    blocks.push(
      [
        `module ${unit.number} (${unit.model.name}) at ${unit.position}, ${used} of ${unit.model.pins} used`,
        "",
        renderTable(WIRING_COLUMNS, rows),
      ].join("\n"),
    );
  }
  const body = blocks.join("\n\n");
  return options.title === undefined ? body : `${options.title}\n\n${body}`;
}

/** A short block of numbers for the top of either sheet. */
export function sheetHeader(
  schedule: Schedule | QuantisedSchedule,
  name: string,
): string {
  const events = schedule.events;
  const first = events[0];
  const last = events[events.length - 1];
  const lines = [
    name,
    `${events.length} cues`,
    first === undefined
      ? "no cues"
      : `first fires at ${formatShowTime(first.ignitionAt)}`,
    last === undefined
      ? ""
      : `last fires at ${formatShowTime(last.ignitionAt)}`,
    `runs ${(raw(schedule.duration) / 1000).toFixed(1)}s`,
  ];
  if (raw(schedule.preRoll) > 0) {
    lines.push(
      `needs ${(raw(schedule.preRoll) / 1000).toFixed(1)}s of pre roll`,
    );
  }
  return lines.filter((line) => line.length > 0).join("\n");
}

/** Cues grouped by position, which is how a crew splits the load between them. */
export function positionSheets(
  schedule: Schedule | QuantisedSchedule,
): Map<string, string> {
  const byPosition = groupBy(schedule.events, (event) => event.position);
  const sheets = new Map<string, string>();
  for (const [position, events] of sortedEntries(byPosition)) {
    sheets.set(
      position,
      cueSheet({
        events,
        preRoll: schedule.preRoll,
        duration: schedule.duration,
      }),
    );
  }
  return sheets;
}
