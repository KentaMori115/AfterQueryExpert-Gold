import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { decodeRegion, decodeResource, decodeSpecies } from "./decode.js";

describe("record decode catalog", () => {
  it("decodes a region", () => {
    const region = decodeRegion({ id: "northern-basin", name: "Northern Basin" }, "r.yaml", []);
    expect(region?.id).toBe("northern-basin");
  });

  it("rejects a missing region id", () => {
    const diagnostics: { code: string }[] = [];
    expect(decodeRegion({ name: "X" }, "r.yaml", diagnostics)).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("BW-ID-003");
  });

  it("decodes a renewable resource", () => {
    const resource = decodeResource(
      { id: "fresh-water", name: "Fresh Water", renewable: true, renewalPerTick: "12" },
      "w.yaml",
      DEFAULT_SCALE,
      [],
    );
    expect(resource?.renewable).toBe(true);
  });

  it("decodes snow-hare stages", () => {
    const species = decodeSpecies(
      {
        id: "snow-hare",
        name: "Snow Hare",
        stages: ["juvenile", "adult"],
        initialStage: "juvenile",
        needs: [],
        mortality: { adult: "0.008" },
        transitions: [{ from: "juvenile", to: "adult", afterTicks: 8 }],
      },
      "s.yaml",
      DEFAULT_SCALE,
      [],
    );
    expect(species?.stages).toEqual(["juvenile", "adult"]);
  });

  it("rejects an uppercase species id", () => {
    const diagnostics: { code: string }[] = [];
    decodeSpecies(
      {
        id: "Snow",
        name: "Snow",
        stages: ["adult"],
        initialStage: "adult",
        needs: [],
        mortality: {},
        transitions: [],
      },
      "s.yaml",
      DEFAULT_SCALE,
      diagnostics,
    );
    expect(diagnostics.some((item) => item.code === "BW-ID-001")).toBe(true);
  });
});
