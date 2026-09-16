import { describe, expect, it } from "vitest";
import { sourceLocation } from "../location/source-location.js";
import type { AuthoredDocument, CapsuleManifest } from "../types.js";
import { workspaceFingerprint } from "./fingerprint.js";

const manifest: CapsuleManifest = {
  biome: "crystal-tundra",
  displayName: "Crystal Tundra",
  calendar: "tundra-year",
  defaultScenario: "baseline",
  include: {
    regions: ["regions/*.yaml"],
    habitats: ["habitats/*.yaml"],
    species: ["species/*.yaml"],
    resources: ["resources/*.yaml"],
    calendars: ["calendars/*.yaml"],
    scenarios: ["scenarios/*.yaml"],
    events: ["events/*.yaml"],
  },
  precision: { scale: "1000000", rounding: "half-even" },
};

function document(path: string, text: string): AuthoredDocument {
  return {
    path,
    group: "regions",
    text,
    data: { id: path },
    location: sourceLocation(path),
  };
}

describe("workspaceFingerprint", () => {
  it("is stable when documents are supplied in a different order", () => {
    const first = workspaceFingerprint(manifest, [
      document("regions/b.yaml", "b"),
      document("regions/a.yaml", "a"),
    ]);
    const second = workspaceFingerprint(manifest, [
      document("regions/a.yaml", "a"),
      document("regions/b.yaml", "b"),
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when file contents change", () => {
    const first = workspaceFingerprint(manifest, [document("regions/a.yaml", "a")]);
    const second = workspaceFingerprint(manifest, [document("regions/a.yaml", "aa")]);
    expect(first).not.toBe(second);
  });
});
