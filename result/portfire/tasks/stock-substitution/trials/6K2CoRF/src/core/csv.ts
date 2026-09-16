/**
 * Comma separated text, the format every firing panel actually speaks.
 *
 * Panels from different makers disagree about almost everything, but they all
 * import and export CSV, and they all do it badly. Fields arrive with stray
 * whitespace, quoted fields arrive with doubled quotes inside them, and files
 * arrive with CRLF endings from a Windows laptop and a trailing blank line.
 * This parser copes with all of that and, importantly, keeps the line number
 * of every record so a bad row can be pointed at.
 */

export interface CsvRow {
  /** One based line number in the source, for diagnostics. */
  readonly line: number;
  readonly fields: readonly string[];
}

export interface CsvOptions {
  readonly delimiter?: string;
  /** Drop rows that are empty or hold only whitespace. */
  readonly skipBlank?: boolean;
  readonly trimFields?: boolean;
}

export function parseCsv(text: string, options: CsvOptions = {}): CsvRow[] {
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1) {
    throw new RangeError("the delimiter has to be a single character");
  }
  const skipBlank = options.skipBlank ?? true;
  const trimFields = options.trimFields ?? true;

  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  // Whether the field being built was opened with a quote. `quoted` itself is
  // already false by the time the field ends, so trimming cannot read it.
  let wasQuoted = false;
  let line = 1;
  let rowLine = 1;
  let touched = false;

  const endField = (): void => {
    fields.push(trimFields && !wasQuoted ? field.trim() : field);
    field = "";
    wasQuoted = false;
  };
  const endRow = (): void => {
    endField();
    const blank = fields.every((value) => value.trim().length === 0);
    if (!skipBlank || !blank || touched) {
      if (!(skipBlank && blank)) {
        rows.push({ line: rowLine, fields });
      }
    }
    fields = [];
    touched = false;
    rowLine = line + 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === undefined) {
      continue;
    }
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") {
          line += 1;
        }
        field += char;
      }
      continue;
    }
    if (char === '"' && field.trim().length === 0) {
      field = "";
      quoted = true;
      wasQuoted = true;
      touched = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      touched = true;
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      endRow();
      line += 1;
      continue;
    }
    field += char;
  }
  if (field.length > 0 || fields.length > 0 || touched) {
    endRow();
  }
  return rows;
}

function needsQuoting(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim()
  );
}

export function quoteField(value: string, delimiter = ","): string {
  return needsQuoting(value, delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

export function writeCsv(
  rows: readonly (readonly string[])[],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  return rows
    .map((row) =>
      row.map((field) => quoteField(field, delimiter)).join(delimiter),
    )
    .join("\n");
}

export interface CsvRecord {
  readonly line: number;
  readonly values: ReadonlyMap<string, string>;
}

export interface CsvTable {
  readonly headers: readonly string[];
  readonly records: readonly CsvRecord[];
}

/**
 * Read a file whose first row names the columns. Headers are lowercased and
 * trimmed, because half the panels on the market export `Cue Time` and the
 * other half export `cue_time`.
 */
export function readTable(text: string, options: CsvOptions = {}): CsvTable {
  const rows = parseCsv(text, options);
  const first = rows[0];
  if (first === undefined) {
    return { headers: [], records: [] };
  }
  const headers = first.fields.map((header) =>
    header.trim().toLowerCase().replace(/\s+/g, "_"),
  );
  const records: CsvRecord[] = [];
  for (const row of rows.slice(1)) {
    const values = new Map<string, string>();
    headers.forEach((header, index) => {
      values.set(header, row.fields[index] ?? "");
    });
    records.push({ line: row.line, values });
  }
  return { headers, records };
}

export function tableToCsv(
  headers: readonly string[],
  records: readonly ReadonlyMap<string, string>[],
): string {
  const rows: string[][] = [[...headers]];
  for (const record of records) {
    rows.push(headers.map((header) => record.get(header) ?? ""));
  }
  return writeCsv(rows);
}
