/**
 * Writing a table out as CSV.
 *
 * Every register in this industry eventually gets asked for as a spreadsheet,
 * usually by somebody outside the company and usually with a deadline. So the
 * export is built to survive that trip rather than to look neat here.
 *
 * Three things it does that a naive join does not. It quotes anything holding
 * a comma, a quote or a newline, which a crew note frequently does. It writes
 * CRLF line endings, because the RFC says so and because the alternative opens
 * as one long line in the software the regulator actually uses. And it puts a
 * byte order mark at the front, without which Excel reads a Norwegian place
 * name as mojibake and somebody blames the fish farm.
 */

export const BOM = '﻿';
export const LINE_END = '\r\n';

export interface CsvColumn<Row> {
  readonly header: string;
  readonly value: (row: Row) => string | number | null | undefined;
}

/** Quoted only where it has to be, so the file stays readable in a text editor. */
export function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function render(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return escapeCell(typeof value === 'number' ? String(value) : value);
}

export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => render(column.value(row))).join(','));
  return [header, ...body].join(LINE_END) + LINE_END;
}

/**
 * A file name that sorts by date in a directory listing and says which site it
 * came from, because these end up in a folder with forty others.
 */
export function exportName(subject: string, siteCode: string, at: number): string {
  const date = new Date(at).toISOString().slice(0, 10);
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${date}-${siteCode.toLowerCase()}-${slug}.csv`;
}

export interface DownloadOptions {
  readonly filename: string;
  readonly content: string;
}

/**
 * Hands the file to the browser.
 *
 * The object URL is revoked on a timer rather than immediately: revoking it in
 * the same tick cancels the download in more than one browser, and the leak
 * from waiting a moment is a few kilobytes.
 */
export function downloadCsv(
  options: DownloadOptions,
  document_: Document | null = globalThis.document ?? null,
): boolean {
  if (document_ === null || typeof URL.createObjectURL !== 'function') return false;

  const blob = new Blob([BOM, options.content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document_.createElement('a');
  link.href = url;
  link.download = options.filename;
  link.style.display = 'none';

  document_.body.append(link);
  link.click();
  link.remove();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);

  return true;
}
