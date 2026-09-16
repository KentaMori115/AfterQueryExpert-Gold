/**
 * Columns of figures, lined up.
 *
 * A winding report is mostly tables — a rope register, a cycle
 * breakdown, a month of inspection returns — and the thing that makes
 * one readable is that the numbers line up on the right and the words
 * line up on the left. That is nearly the whole of it, and it is worth
 * doing properly once rather than badly in a dozen commands.
 */

import { WindingError, count } from "../errors.ts";

/** Which way a column lines up. */
export type Align = "left" | "right" | "centre";

/** One column of a table. */
export interface Column {
  /** What it is headed. */
  readonly head: string;
  /** Which way it lines up. */
  readonly align: Align;
}

/** A column that lines up on the left. */
export function left(head: string): Column {
  return { head, align: "left" };
}

/** A column that lines up on the right, as figures do. */
export function right(head: string): Column {
  return { head, align: "right" };
}

/**
 * A column with its contents in the middle.
 *
 * For the columns that are neither a name nor a figure: a verdict, a
 * severity, a tick. They read badly pushed to either edge and there are
 * enough of them on an audit sheet to be worth the third case.
 */
export function centre(head: string): Column {
  return { head, align: "centre" };
}

function laid(text: string, width: number, align: Align): string {
  const short = Math.max(0, width - text.length);
  if (align === "left") return text + " ".repeat(short);
  if (align === "right") return " ".repeat(short) + text;
  const before = Math.floor(short / 2);
  return " ".repeat(before) + text + " ".repeat(short - before);
}

function widthOf(columns: readonly Column[], rows: readonly (readonly string[])[], at: number): number {
  let width = (columns[at] as Column).head.length;
  for (const row of rows) width = Math.max(width, (row[at] ?? "").length);
  return width;
}

/**
 * A table, as lines.
 *
 * The head, a rule under it, then the rows. Two spaces between columns,
 * which is enough to read and not so much that a rope register runs off
 * the side of a page.
 */
export function table(columns: readonly Column[], rows: readonly (readonly string[])[], gap = 2): string[] {
  if (columns.length === 0) throw new WindingError("a table with no columns has nothing to say", "columns");
  count(gap, "gap");
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new WindingError(`a row of ${row.length} does not fit ${columns.length} columns`, "row");
    }
  }
  const widths = columns.map((_, at) => widthOf(columns, rows, at));
  const between = " ".repeat(gap);
  const out: string[] = [];
  out.push(columns.map((each, at) => laid(each.head, widths[at] as number, each.align)).join(between).trimEnd());
  out.push(widths.map((each) => "-".repeat(each)).join(between));
  for (const row of rows) {
    out.push(
      row.map((each, at) => laid(each, widths[at] as number, (columns[at] as Column).align)).join(between).trimEnd(),
    );
  }
  return out;
}

/** A table of two columns: a thing, and what it is. */
export function pairs(rows: readonly (readonly [string, string])[]): string[] {
  return table([left(""), right("")], rows.map((each) => [each[0], each[1]]));
}

/** The rows of a table sorted by one of its columns, as text. */
export function sortedBy(rows: readonly (readonly string[])[], at: number): string[][] {
  return [...rows].map((each) => [...each]).sort((a, b) => (a[at] ?? "").localeCompare(b[at] ?? ""));
}

/**
 * The rows of a table sorted by one of its columns read as a number.
 *
 * The commas have to come out first. Every figure in this library that
 * reaches a table has been through the formatter, and the formatter
 * groups thousands — so a sorter that read the digits as written would
 * put "1,202" before "288" and would do it silently, on exactly the
 * tables where the largest item is the one being looked for.
 */
export function sortedByNumber(rows: readonly (readonly string[])[], at: number, descending = false): string[][] {
  const value = (row: readonly string[]): number => {
    const found = /-?\d+(\.\d+)?/.exec((row[at] ?? "").replace(/,/g, ""));
    return found === null ? Number.NEGATIVE_INFINITY : Number(found[0]);
  };
  return [...rows]
    .map((each) => [...each])
    .sort((a, b) => (descending ? value(b) - value(a) : value(a) - value(b)));
}

/**
 * A bar of a given length, for a column of them.
 *
 * A cycle is easier to read as bars than as figures, because the
 * question it is usually asked is where the time goes, and the eye
 * answers that from a bar before the mind has read the number.
 */
export function barOf(value: number, width = 20, full = "#", empty = "."): string {
  count(width, "width");
  const found = Math.max(0, Math.min(1, value));
  const filled = Math.round(found * width);
  return full.repeat(filled) + empty.repeat(width - filled);
}

/** Two blocks of lines set beside each other. */
export function beside(first: readonly string[], second: readonly string[], gap = 4): string[] {
  count(gap, "gap");
  const width = first.reduce((most, each) => Math.max(most, each.length), 0);
  const tall = Math.max(first.length, second.length);
  const out: string[] = [];
  for (let at = 0; at < tall; at += 1) {
    const one = first[at] ?? "";
    const other = second[at] ?? "";
    out.push((one + " ".repeat(Math.max(0, width - one.length)) + " ".repeat(gap) + other).trimEnd());
  }
  return out;
}

/** Lines pushed in from the margin. */
export function indented(lines: readonly string[], by = 2): string[] {
  count(by, "by");
  return lines.map((each) => (each.length === 0 ? each : " ".repeat(by) + each));
}

/** A rule of a given width. */
export function ruled(width: number, character = "="): string {
  count(width, "width");
  if (character.length !== 1) throw new WindingError("a rule is drawn with one character", "character");
  return character.repeat(width);
}

/** Rows with a blank line every so often, so a long column can be read across. */
export function grouped(rows: readonly string[], every = 5): string[] {
  count(every, "every");
  if (every === 0) throw new WindingError("rows cannot be grouped in noughts", "every");
  const out: string[] = [];
  for (let at = 0; at < rows.length; at += 1) {
    if (at > 0 && at % every === 0) out.push("");
    out.push(rows[at] as string);
  }
  return out;
}

/** Blocks of lines with a blank line between each pair of them. */
export function blocks(...groups: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(...group);
  }
  return out;
}
