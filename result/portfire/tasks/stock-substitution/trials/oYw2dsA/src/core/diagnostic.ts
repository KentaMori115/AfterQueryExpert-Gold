import type { SourceFile, Span } from "./span.js";
import { formatLocation, snippet } from "./span.js";

/**
 * What portfire says when something is wrong, and how loudly.
 *
 * Severity is not cosmetic here. `error` means the show will not compile,
 * `warning` means it compiles but a competent shooter would look at it, and
 * `note` is context attached to one of the other two. The CLI's exit code
 * reads only the error count, so anything that must stop a load has to be an
 * error and anything that must not has to be lower.
 */
export type Severity = "error" | "warning" | "note";

const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  note: 2,
};

export interface Diagnostic {
  /** Stable code such as `PF0210`, so a message can be looked up or muted. */
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  /** Where in the source, when the diagnostic came from parsed text. */
  readonly span?: Span;
  /** Which source, when more than one file is in play. */
  readonly file?: SourceFile;
  /** A suggested fix, phrased as an instruction. */
  readonly help?: string;
}

export interface DiagnosticInit {
  readonly code: string;
  readonly message: string;
  readonly span?: Span;
  readonly file?: SourceFile;
  readonly help?: string;
}

function build(severity: Severity, init: DiagnosticInit): Diagnostic {
  const diagnostic: {
    code: string;
    severity: Severity;
    message: string;
    span?: Span;
    file?: SourceFile;
    help?: string;
  } = {
    code: init.code,
    severity,
    message: init.message,
  };
  if (init.span !== undefined) {
    diagnostic.span = init.span;
  }
  if (init.file !== undefined) {
    diagnostic.file = init.file;
  }
  if (init.help !== undefined) {
    diagnostic.help = init.help;
  }
  return diagnostic;
}

export function error(init: DiagnosticInit): Diagnostic {
  return build("error", init);
}

export function warning(init: DiagnosticInit): Diagnostic {
  return build("warning", init);
}

export function note(init: DiagnosticInit): Diagnostic {
  return build("note", init);
}

export function isError(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === "error";
}

/**
 * Order diagnostics the way a person reads them, which is by position in the
 * file first and by severity only within a position. Sorting by severity
 * first scatters the errors of one cue across the whole report.
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const fileA = a.file?.name ?? "";
  const fileB = b.file?.name ?? "";
  if (fileA !== fileB) {
    return fileA < fileB ? -1 : 1;
  }
  const startA = a.span?.start ?? Number.MAX_SAFE_INTEGER;
  const startB = b.span?.start ?? Number.MAX_SAFE_INTEGER;
  if (startA !== startB) {
    return startA - startB;
  }
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** A growing pile of diagnostics with the counting done for you. */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];

  add(diagnostic: Diagnostic): this {
    this.items.push(diagnostic);
    return this;
  }

  addAll(diagnostics: Iterable<Diagnostic>): this {
    for (const diagnostic of diagnostics) {
      this.items.push(diagnostic);
    }
    return this;
  }

  error(init: DiagnosticInit): this {
    return this.add(error(init));
  }

  warning(init: DiagnosticInit): this {
    return this.add(warning(init));
  }

  note(init: DiagnosticInit): this {
    return this.add(note(init));
  }

  get size(): number {
    return this.items.length;
  }

  get errorCount(): number {
    return this.items.filter(isError).length;
  }

  get warningCount(): number {
    return this.items.filter((item) => item.severity === "warning").length;
  }

  hasErrors(): boolean {
    return this.items.some(isError);
  }

  /** A stable, position ordered copy. The bag itself keeps insertion order. */
  sorted(): Diagnostic[] {
    return [...this.items].sort(compareDiagnostics);
  }

  all(): readonly Diagnostic[] {
    return this.items;
  }

  bySeverity(severity: Severity): Diagnostic[] {
    return this.items.filter((item) => item.severity === severity);
  }

  byCode(code: string): Diagnostic[] {
    return this.items.filter((item) => item.code === code);
  }
}

export interface FormatOptions {
  /** Show the source line with a caret under the span. */
  readonly showSource?: boolean;
}

export function formatDiagnostic(
  diagnostic: Diagnostic,
  options: FormatOptions = {},
): string {
  const parts: string[] = [];
  const where =
    diagnostic.file !== undefined && diagnostic.span !== undefined
      ? `${formatLocation(diagnostic.file, diagnostic.span)}: `
      : "";
  parts.push(
    `${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
  );
  if (
    (options.showSource ?? true) &&
    diagnostic.file !== undefined &&
    diagnostic.span !== undefined
  ) {
    parts.push(snippet(diagnostic.file, diagnostic.span));
  }
  if (diagnostic.help !== undefined) {
    parts.push(`help: ${diagnostic.help}`);
  }
  return parts.join("\n");
}

export function formatBag(
  bag: DiagnosticBag,
  options: FormatOptions = {},
): string {
  return bag
    .sorted()
    .map((diagnostic) => formatDiagnostic(diagnostic, options))
    .join("\n\n");
}

export function summarise(bag: DiagnosticBag): string {
  const errors = bag.errorCount;
  const warnings = bag.warningCount;
  const errorWord = errors === 1 ? "error" : "errors";
  const warningWord = warnings === 1 ? "warning" : "warnings";
  return `${errors} ${errorWord}, ${warnings} ${warningWord}`;
}
