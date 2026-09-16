import { LineCounter, parseDocument } from "yaml";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { diagnostic } from "../diagnostics/diagnostic.js";
import { sourceLocation } from "../location/source-location.js";
import type { Diagnostic, LogicalPath, SourceLocation } from "../types.js";

export type ParsedDocument = {
  readonly data: unknown;
  readonly location: SourceLocation;
  readonly diagnostics: readonly Diagnostic[];
};

function offsetToLocation(
  path: LogicalPath,
  lineCounter: LineCounter,
  offset: number | undefined,
): SourceLocation {
  if (offset === undefined) {
    return sourceLocation(path);
  }
  const pos = lineCounter.linePos(offset);
  return sourceLocation(path, pos.line, pos.col);
}

export function parseYamlDocument(path: LogicalPath, text: string): ParsedDocument {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, {
    lineCounter,
    uniqueKeys: true,
    prettyErrors: true,
    keepSourceTokens: true,
  });

  const diagnostics: Diagnostic[] = [];
  for (const error of document.errors) {
    const isDuplicate = /Map keys must be unique|duplicate/i.test(error.message);
    diagnostics.push(
      diagnostic(
        isDuplicate ? DiagnosticCode.DUPLICATE_KEY : DiagnosticCode.PARSE_ERROR,
        "error",
        error.message.replace(/\s+/g, " ").trim(),
        offsetToLocation(path, lineCounter, error.pos?.[0]),
      ),
    );
  }

  if (diagnostics.length > 0) {
    return {
      data: undefined,
      location: sourceLocation(path),
      diagnostics,
    };
  }

  const rangeStart = document.contents?.range?.[0];
  return {
    data: document.toJS(),
    location: offsetToLocation(path, lineCounter, rangeStart),
    diagnostics: [],
  };
}
