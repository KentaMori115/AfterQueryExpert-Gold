import type { LogicalPath, SourceLocation } from "../types.js";

export function sourceLocation(path: LogicalPath, line = 1, column = 1): SourceLocation {
  return { path, line, column };
}

export function compareLocations(left: SourceLocation, right: SourceLocation): number {
  const byPath = left.path.localeCompare(right.path);
  if (byPath !== 0) {
    return byPath;
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.column - right.column;
}

export function formatLocation(location: SourceLocation): string {
  return `${location.path}:${location.line}:${location.column}`;
}
