export const DiagnosticCode = {
  MISSING_MANIFEST: "BW-SRC-001",
  PARSE_ERROR: "BW-SRC-002",
  DUPLICATE_KEY: "BW-SRC-003",
  UNSUPPORTED_EXTENSION: "BW-SRC-004",
  PATH_ESCAPE: "BW-SRC-005",
  DUPLICATE_PATH: "BW-SRC-006",
  INVALID_INCLUDE: "BW-SRC-007",
  INVALID_MANIFEST: "BW-SRC-008",
  EMPTY_INCLUDE: "BW-SRC-009",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];
