import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { discoverAuthoredFiles } from "./discover.js";
import { matchesGlob } from "./globs.js";

function writeCapsule(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "biomeweaver-"));
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

const MANIFEST = `
biome: crystal-tundra
displayName: Crystal Tundra
calendar: tundra-year
defaultScenario: baseline
include:
  regions: regions/*.yaml
  habitats: habitats/*.yaml
  species: species/*.yaml
  resources: resources/*.yaml
  calendars: calendars/*.yaml
  scenarios: scenarios/*.yaml
  events: events/*.yaml
precision:
  scale: 1000000
  rounding: half-even
`;

describe("discoverAuthoredFiles", () => {
  it("expands include globs in stable path order", () => {
    const root = writeCapsule({
      "biomeweaver.yaml": MANIFEST,
      "regions/southern-ridge.yaml": "kind: region\nid: southern-ridge\n",
      "regions/northern-basin.yaml": "kind: region\nid: northern-basin\n",
      "habitats/silver-grassland.yaml": "kind: habitat\nid: silver-grassland\n",
    });
    const result = discoverAuthoredFiles(root);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual([
      "habitats/silver-grassland.yaml",
      "regions/northern-basin.yaml",
      "regions/southern-ridge.yaml",
    ]);
  });

  it("rejects include patterns that escape the capsule root", () => {
    const root = writeCapsule({
      "biomeweaver.yaml": MANIFEST.replace("regions/*.yaml", "../outside/*.yaml"),
    });
    const result = discoverAuthoredFiles(root);
    expect(result.diagnostics.some((item) => item.code === DiagnosticCode.PATH_ESCAPE)).toBe(true);
  });

  it("reports a missing manifest", () => {
    const root = writeCapsule({ "regions/northern-basin.yaml": "kind: region\n" });
    const result = discoverAuthoredFiles(root);
    expect(result.diagnostics[0]?.code).toBe(DiagnosticCode.MISSING_MANIFEST);
  });

  it("matches authored glob patterns", () => {
    expect(matchesGlob("species/snow-hare.yaml", "species/*.yaml")).toBe(true);
    expect(matchesGlob("species/nested/snow-hare.yaml", "species/*.yaml")).toBe(false);
  });
});
