import { describe, expect, it } from "vitest";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { parseJsonDocument } from "./parse-json.js";

describe("parseJsonDocument", () => {
  it("parses an object and keeps the logical path", () => {
    const parsed = parseJsonDocument(
      "regions/basin.json",
      '{"kind":"region","id":"northern-basin"}',
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.data).toEqual({ kind: "region", id: "northern-basin" });
    expect(parsed.location.path).toBe("regions/basin.json");
  });

  it("rejects duplicate mapping keys", () => {
    const parsed = parseJsonDocument("dup.json", '{"id":"a","id":"b"}');
    expect(parsed.diagnostics[0]?.code).toBe(DiagnosticCode.DUPLICATE_KEY);
  });

  it("rejects trailing input", () => {
    const parsed = parseJsonDocument("trail.json", '{"id":"a"} 12');
    expect(parsed.diagnostics[0]?.code).toBe(DiagnosticCode.PARSE_ERROR);
  });
});
