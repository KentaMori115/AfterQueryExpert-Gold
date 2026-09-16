/**
 * Laying out the text reports.
 *
 * A cue sheet gets printed and taken onto a field, often in the dark, so the
 * columns have to line up and the widths have to be predictable. This is the
 * only place in portfire that knows about column alignment, so the CLI never
 * has to build a row by hand with padStart.
 */

export type Align = "left" | "right" | "center";

export interface Column {
  readonly header: string;
  readonly align?: Align;
  /** Truncate cell text past this width, with an ellipsis. */
  readonly maxWidth?: number;
}

export interface TableOptions {
  /** Two spaces reads better on a printed sheet than a pipe character. */
  readonly separator?: string;
  /** Draw a rule of dashes under the header row. */
  readonly rule?: boolean;
  readonly indent?: string;
}

export function pad(value: string, width: number, align: Align): string {
  const short = width - value.length;
  if (short <= 0) {
    return value;
  }
  if (align === "right") {
    return " ".repeat(short) + value;
  }
  if (align === "center") {
    const left = Math.floor(short / 2);
    return " ".repeat(left) + value + " ".repeat(short - left);
  }
  return value + " ".repeat(short);
}

export function truncate(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (value.length <= width) {
    return value;
  }
  if (width <= 3) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 3)}...`;
}

/**
 * Render rows under headers, sizing every column to its widest cell. Trailing
 * whitespace is stripped from each line, because a printed sheet with trailing
 * spaces wraps unpredictably on a narrow terminal.
 */
export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string {
  const separator = options.separator ?? "  ";
  const indent = options.indent ?? "";
  const cells = rows.map((row) =>
    columns.map((column, index) => {
      const raw = row[index] ?? "";
      return column.maxWidth === undefined
        ? raw
        : truncate(raw, column.maxWidth);
    }),
  );
  const widths = columns.map((column, index) => {
    let width = column.header.length;
    for (const row of cells) {
      const cell = row[index] ?? "";
      if (cell.length > width) {
        width = cell.length;
      }
    }
    return width;
  });
  const line = (values: readonly string[]): string =>
    (
      indent +
      values
        .map((value, index) =>
          pad(value, widths[index] ?? 0, columns[index]?.align ?? "left"),
        )
        .join(separator)
    ).trimEnd();

  const out: string[] = [line(columns.map((column) => column.header))];
  if (options.rule ?? true) {
    out.push(line(widths.map((width) => "-".repeat(width))));
  }
  for (const row of cells) {
    out.push(line(row));
  }
  return out.join("\n");
}

/** Break a paragraph onto lines no longer than `width`, on word boundaries. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) {
    return [text];
  }
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

export function indentLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

/** `1 shell`, `2 shells`, without a helper at every call site. */
export function plural(count: number, singular: string, many?: string): string {
  const word = count === 1 ? singular : (many ?? `${singular}s`);
  return `${count} ${word}`;
}

/** Join a list the way English does, with an `and` before the last item. */
export function listPhrase(items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }
  if (items.length === 1) {
    return items[0] ?? "";
  }
  const head = items.slice(0, -1).join(", ");
  return `${head} and ${items[items.length - 1] ?? ""}`;
}

/**
 * A two column table of names and values.
 *
 * Six places were spelling out the same pair of column headers, and three of
 * them had picked different words for the same two columns, so a reader moving
 * between two reports had to work out that `item` and `what` meant the same
 * thing. One helper settles it.
 */
export function keyValueTable(
  rows: readonly (readonly [string, string])[],
  headers: readonly [string, string] = ["what", "value"],
): string {
  return renderTable(
    [{ header: headers[0] }, { header: headers[1] }],
    rows.map((row) => [row[0], row[1]]),
  );
}

/** A two column table of names and counts, right aligned as counts should be. */
export function countTable(
  entries: readonly (readonly [string, number])[],
  headers: readonly [string, string] = ["name", "count"],
): string {
  return renderTable(
    [{ header: headers[0] }, { header: headers[1], align: "right" }],
    entries.map(([name, count]) => [name, String(count)]),
  );
}

/** A fixed decimal string that never shows negative zero or exponents. */
export function fixed(value: number, places: number): string {
  const rounded = Number(value.toFixed(places));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return safe.toFixed(places);
}
