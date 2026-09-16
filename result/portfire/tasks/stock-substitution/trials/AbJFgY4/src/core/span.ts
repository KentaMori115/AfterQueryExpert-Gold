/**
 * Positions inside a cue script, and the machinery for pointing at one.
 *
 * A show script is written by hand in a text editor at two in the morning, so
 * the diagnostics have to name a line and a column and then show the line with
 * a caret under the offending token. Anything less and the shooter is counting
 * lines by eye.
 */

/** A zero based offset into the source text. */
export type Offset = number;

export interface Position {
  /** Zero based offset, which is what the lexer actually tracks. */
  readonly offset: Offset;
  /** One based line, which is what an editor shows. */
  readonly line: number;
  /** One based column, counted in UTF-16 code units. */
  readonly column: number;
}

export interface Span {
  readonly start: Offset;
  /** Exclusive. A zero width span is legal and marks an insertion point. */
  readonly end: Offset;
}

export function span(start: Offset, end: Offset): Span {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new RangeError("a span needs integer offsets");
  }
  if (start < 0) {
    throw new RangeError(`span start ${start} is negative`);
  }
  if (end < start) {
    throw new RangeError(`span ends at ${end} before it starts at ${start}`);
  }
  return { start, end };
}

export function spanLength(value: Span): number {
  return value.end - value.start;
}

export function joinSpans(a: Span, b: Span): Span {
  return span(Math.min(a.start, b.start), Math.max(a.end, b.end));
}

export function spanContains(outer: Span, offset: Offset): boolean {
  return offset >= outer.start && offset < outer.end;
}

/**
 * A named body of source text with a line index built once.
 *
 * Building the index eagerly costs one pass over the file and turns every
 * later offset lookup into a binary search, which matters because a large
 * pyromusical script produces thousands of diagnostics during development.
 */
export class SourceFile {
  readonly name: string;
  readonly text: string;
  /** Offset at which each line starts, so `lineStarts[0]` is always 0. */
  private readonly lineStarts: readonly number[];

  constructor(name: string, text: string) {
    this.name = name;
    this.text = text;
    this.lineStarts = indexLines(text);
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Turn an offset into a line and column, clamping past the end. */
  positionAt(offset: Offset): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const start = this.lineStarts[mid];
      if (start !== undefined && start <= clamped) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    const lineStart = this.lineStarts[low] ?? 0;
    return { offset: clamped, line: low + 1, column: clamped - lineStart + 1 };
  }

  /** Turn a one based line and column back into an offset. */
  offsetAt(line: number, column: number): Offset {
    const index = Math.max(0, Math.min(line - 1, this.lineStarts.length - 1));
    const start = this.lineStarts[index] ?? 0;
    const end = this.lineEnd(index);
    return Math.min(start + Math.max(0, column - 1), end);
  }

  /** The text of a one based line, without its terminator. */
  lineText(line: number): string {
    const index = line - 1;
    const start = this.lineStarts[index];
    if (start === undefined) {
      return "";
    }
    return this.text.slice(start, this.lineEnd(index));
  }

  slice(value: Span): string {
    return this.text.slice(value.start, value.end);
  }

  private lineEnd(index: number): number {
    const next = this.lineStarts[index + 1];
    if (next === undefined) {
      return this.text.length;
    }
    let end = next;
    if (end > 0 && this.text[end - 1] === "\n") {
      end -= 1;
    }
    if (end > 0 && this.text[end - 1] === "\r") {
      end -= 1;
    }
    return end;
  }
}

function indexLines(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

export interface SnippetOptions {
  /** How many characters of the line to show before truncating. */
  readonly maxWidth?: number;
}

/**
 * Render the offending line with a caret run under the span. Multi line spans
 * are trimmed to their first line, because a caret run over a whole block is
 * noise rather than information.
 */
export function snippet(
  file: SourceFile,
  value: Span,
  options: SnippetOptions = {},
): string {
  const maxWidth = options.maxWidth ?? 100;
  const start = file.positionAt(value.start);
  const end = file.positionAt(value.end);
  const line = file.lineText(start.line);
  const gutter = String(start.line);
  const pad = " ".repeat(gutter.length);
  const lastColumn = end.line === start.line ? end.column : line.length + 1;
  const width = Math.max(1, lastColumn - start.column);
  const shown = line.length > maxWidth ? `${line.slice(0, maxWidth)}...` : line;
  const caretColumn = Math.min(start.column, shown.length + 1);
  const caret = `${" ".repeat(caretColumn - 1)}${"^".repeat(width)}`;
  return `${gutter} | ${shown}\n${pad} | ${caret}`;
}

export function formatLocation(file: SourceFile, value: Span): string {
  const start = file.positionAt(value.start);
  return `${file.name}:${start.line}:${start.column}`;
}
