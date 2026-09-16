import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("the public surface", () => {
  it("exports the whole pipeline", () => {
    for (const name of [
      "compile",
      "parseScript",
      "expandScript",
      "resolveShots",
      "allocatePins",
      "buildSchedule",
      "quantiseSchedule",
    ]) {
      expect(name in api).toBe(true);
    }
  });

  it("exports the readers", () => {
    for (const name of [
      "parseCatalog",
      "parseRig",
      "parseMagazine",
      "parseContinuity",
      "loadScript",
    ]) {
      expect(name in api).toBe(true);
    }
  });

  it("exports the checks", () => {
    for (const name of [
      "checkSafety",
      "checkLoad",
      "checkDensity",
      "checkWind",
      "checkNoise",
      "checkCrowd",
      "checkStore",
      "checkBalance",
      "checkPalette",
    ]) {
      expect(name in api).toBe(true);
    }
  });

  it("exports the outputs", () => {
    for (const name of [
      "firingTableCsv",
      "cueSheet",
      "wiringSheet",
      "showPack",
      "permitDocument",
      "writeShowJson",
      "sitePlan",
      "storyboard",
    ]) {
      expect(name in api).toBe(true);
    }
  });

  it("exports the command line as a library too", () => {
    for (const name of ["main", "runMain", "buildCommands", "MemoryEnv"]) {
      expect(name in api).toBe(true);
    }
  });

  it("exports a version", () => {
    expect(api.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exports a good deal without exporting everything twice", () => {
    const names = Object.keys(api);
    expect(names.length).toBeGreaterThan(400);
    expect(new Set(names).size).toBe(names.length);
  });
});
