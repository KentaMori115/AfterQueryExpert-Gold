import { compareLocations } from "../location/source-location.js";
import type { Diagnostic, DiagnosticSeverity, SourceLocation } from "../types.js";

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  location?: SourceLocation,
): Diagnostic {
  return location === undefined
    ? { code, severity, message }
    : { code, severity, message, location };
}

export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const severityRank: Record<DiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const bySeverity = severityRank[a.severity] - severityRank[b.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  const byCode = a.code.localeCompare(b.code);
  if (byCode !== 0) {
    return byCode;
  }
  if (a.location && b.location) {
    const byLocation = compareLocations(a.location, b.location);
    if (byLocation !== 0) {
      return byLocation;
    }
  } else if (a.location) {
    return -1;
  } else if (b.location) {
    return 1;
  }
  return a.message.localeCompare(b.message);
}

export function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}
