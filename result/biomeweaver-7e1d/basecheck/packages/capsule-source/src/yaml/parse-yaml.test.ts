import { describe, expect, it } from "vitest";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { parseYamlDocument } from "./parse-yaml.js";

describe("parseYamlDocument", () => {
  it("preserves file, line, and column for a mapping", () => {
    const parsed = parseYamlDocument("species/snow-hare.yaml", "kind: species\nid: snow-hare\n");
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.location.path).toBe("species/snow-hare.yaml");
    expect(parsed.location.line).toBeGreaterThanOrEqual(1);
    expect(parsed.data).toEqual({ kind: "species", id: "snow-hare" });
  });

  it("reports duplicate keys with a source location", () => {
    const parsed = parseYamlDocument("dup.yaml", "id: one\nid: two\n");
    expect(parsed.diagnostics[0]?.code).toBe(DiagnosticCode.DUPLICATE_KEY);
    expect(parsed.diagnostics[0]?.location?.path).toBe("dup.yaml");
  });

  it("reports malformed YAML", () => {
    const parsed = parseYamlDocument("bad.yaml", "id: [unterminated\n");
    expect(parsed.diagnostics[0]?.code).toBe(DiagnosticCode.PARSE_ERROR);
  });
});
