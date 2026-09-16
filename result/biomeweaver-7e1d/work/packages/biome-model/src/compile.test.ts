import { describe, expect, it } from "vitest";
import { completeBiome, invalidModel } from "../../../ecosystem-lab/helpers/paths.js";
import { compileCapsule } from "./compile.js";

describe("compileCapsule", () => {
  it("compiles crystal-tundra species, regions, and the default scenario", () => {
    const result = compileCapsule({ root: completeBiome("crystal-tundra") });
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.model?.species["snow-hare"]?.name).toBe("Snow Hare");
    expect(result.model?.regions["northern-basin"]).toBeDefined();
    expect(result.model?.scenarios["baseline"]?.durationTicks).toBe(120);
  });

  it("rejects a predator that names a missing prey", () => {
    const result = compileCapsule({ root: invalidModel("unknown-prey") });
    expect(result.model).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "BW-ID-006")).toBe(true);
  });

  it("rejects a negative initial population", () => {
    const result = compileCapsule({ root: invalidModel("negative-count") });
    expect(result.diagnostics.some((item) => item.code === "BW-ID-004")).toBe(true);
  });
});
