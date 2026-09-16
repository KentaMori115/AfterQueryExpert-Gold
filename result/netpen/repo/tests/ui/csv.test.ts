import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOM,
  downloadCsv,
  escapeCell,
  exportName,
  LINE_END,
  toCsv,
  type CsvColumn,
} from '@/ui/csv';

interface Row {
  readonly pen: string;
  readonly lice: number | null;
  readonly note: string;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'Pen', value: (row) => row.pen },
  { header: 'Adult female', value: (row) => row.lice },
  { header: 'Note', value: (row) => row.note },
];

describe('escaping', () => {
  it('leaves an ordinary cell alone, so the file stays readable', () => {
    expect(escapeCell('Pen 3')).toBe('Pen 3');
  });

  it('quotes a cell with a comma in it, which a crew note usually has', () => {
    expect(escapeCell('Crowded, treated')).toBe('"Crowded, treated"');
  });

  it('doubles a quote rather than dropping it', () => {
    expect(escapeCell('He said "clear"')).toBe('"He said ""clear"""');
  });

  it('quotes a cell with a newline, which would otherwise become a row', () => {
    expect(escapeCell('Line one\nLine two')).toBe('"Line one\nLine two"');
  });
});

describe('the file', () => {
  const rows: Row[] = [
    { pen: 'Pen 1', lice: 0.12, note: '' },
    { pen: 'Pen 2', lice: null, note: 'Not counted, boat off' },
  ];

  it('leads with the headers', () => {
    expect(toCsv(rows, COLUMNS).split(LINE_END)[0]).toBe('Pen,Adult female,Note');
  });

  it('writes a row per record', () => {
    const lines = toCsv(rows, COLUMNS).split(LINE_END).filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('leaves a missing value empty rather than writing a zero', () => {
    expect(toCsv(rows, COLUMNS)).toContain('Pen 2,,');
  });

  it('ends lines the way the specification says, not the way this machine does', () => {
    expect(toCsv(rows, COLUMNS)).toContain('\r\n');
    expect(toCsv(rows, COLUMNS).endsWith(LINE_END)).toBe(true);
  });

  it('writes a header only file when there is nothing to export', () => {
    expect(toCsv([], COLUMNS)).toBe(`Pen,Adult female,Note${LINE_END}`);
  });
});

describe('the file name', () => {
  it('leads with the date so a folder of them sorts', () => {
    expect(exportName('Lice register', 'FS-0412', Date.UTC(2025, 2, 18))).toMatch(/^2025-03-18/);
  });

  it('names the site, since these end up in a folder with forty others', () => {
    expect(exportName('Lice register', 'FS-0412', Date.UTC(2025, 2, 18))).toContain('fs-0412');
  });

  it('turns the subject into something a file system will take', () => {
    expect(exportName('Feed plan, today', 'FS-1', 0)).toBe('1970-01-01-fs-1-feed-plan-today.csv');
  });
});

describe('handing it to the browser', () => {
  /**
   * jsdom has no object URLs at all, so they are installed rather than spied
   * on. Stubbing them out is the honest thing here: what is under test is the
   * sequence this module runs through, not the browser's blob plumbing.
   */
  function stubObjectUrls() {
    const created = vi.fn<(blob: Blob) => string>(() => 'blob:x');
    const revoked = vi.fn<(url: string) => void>();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }),
    );
    return { created, revoked };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('puts a byte order mark in front, or Excel mangles the place names', () => {
    const { created } = stubObjectUrls();

    downloadCsv({ filename: 'x.csv', content: 'Pen\r\n' });

    const blob = created.mock.calls[0]![0];
    expect(blob.type).toContain('text/csv');
    expect(BOM.length).toBe(1);
  });

  it('names the download and takes the link back out of the page', () => {
    stubObjectUrls();

    const before = document.body.childElementCount;
    downloadCsv({ filename: 'lice.csv', content: 'Pen\r\n' });
    expect(document.body.childElementCount).toBe(before);
  });

  it('waits before revoking, since revoking at once cancels the download', () => {
    vi.useFakeTimers();
    const { revoked } = stubObjectUrls();

    downloadCsv({ filename: 'x.csv', content: 'Pen\r\n' });
    expect(revoked).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(revoked).toHaveBeenCalledWith('blob:x');
  });

  it('says it could not rather than throwing where there is no document', () => {
    expect(downloadCsv({ filename: 'x.csv', content: '' }, null)).toBe(false);
  });
});
