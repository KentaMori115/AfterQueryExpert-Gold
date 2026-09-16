import { describe, expect, it } from "vitest";
import { sourceLocation } from "../location/source-location.js";
import { compareDiagnostics, diagnostic, hasErrorDiagnostics } from "./diagnostic.js";

describe("diagnostics", () => {
  it("sorts errors before warnings and infos", () => {
    const items = [
      diagnostic("BW-SRC-003", "info", "note"),
      diagnostic("BW-SRC-002", "error", "bad"),
      diagnostic("BW-SRC-001", "warning", "maybe"),
    ];
    const sorted = [...items].sort(compareDiagnostics);
    expect(sorted.map((item) => item.severity)).toEqual(["error", "warning", "info"]);
  });

  it("detects an error diagnostic", () => {
    expect(hasErrorDiagnostics([diagnostic("BW-SRC-002", "warning", "maybe")])).toBe(false);
    expect(
      hasErrorDiagnostics([diagnostic("BW-SRC-002", "error", "bad", sourceLocation("a.yaml"))]),
    ).toBe(true);
  });
});
