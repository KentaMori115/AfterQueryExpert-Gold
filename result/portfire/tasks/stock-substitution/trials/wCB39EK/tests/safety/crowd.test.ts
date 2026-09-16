import { describe, expect, it } from "vitest";
import {
  DENSITIES,
  EXIT_RATE_PER_MINUTE,
  areaOf,
  capacityFor,
  checkCrowd,
  crowdVerdict,
  depthNeeded,
  describeCrowd,
  frontageOf,
  insideViewingArea,
} from "../../src/safety/crowd.js";
import { boundary, point, straightLine } from "../../src/safety/site.js";
import { metres } from "../../src/core/units.js";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const area = { frontage: metres(200), depth: metres(50) };

describe("areaOf and capacityFor", () => {
  it("multiplies frontage by depth", () => {
    expect(areaOf(area)).toBe(10000);
  });

  it("holds more people at a higher density", () => {
    expect(capacityFor(area, "comfortable")).toBe(20000);
    expect(capacityFor(area, "dense")).toBe(40000);
    expect(capacityFor(area, "seated")).toBe(10000);
  });

  it("rounds down rather than up", () => {
    expect(capacityFor({ frontage: metres(1), depth: metres(1.4) })).toBe(2);
  });

  it("holds nobody in no space", () => {
    expect(capacityFor({ frontage: metres(0), depth: metres(50) })).toBe(0);
  });

  it("orders the densities sensibly", () => {
    expect(DENSITIES.seated).toBeLessThan(DENSITIES.comfortable);
    expect(DENSITIES.comfortable).toBeLessThan(DENSITIES.dense);
    expect(DENSITIES.dense).toBeLessThan(DENSITIES.packed);
  });
});

describe("frontageOf", () => {
  it("measures a straight line", () => {
    expect(
      frontageOf(straightLine("line", point(-100, 0), point(100, 0))),
    ).toBe(200);
  });

  it("adds the segments of a polyline", () => {
    const bent = boundary("bent", [point(0, 0), point(30, 40), point(60, 40)]);
    expect(frontageOf(bent)).toBe(80);
  });
});

describe("crowdVerdict", () => {
  it("reports capacity, headroom and density", () => {
    const verdict = crowdVerdict({
      expected: 5000,
      area,
      density: "comfortable",
    });
    expect(verdict.capacity).toBe(20000);
    expect(verdict.headroom).toBe(15000);
    expect(verdict.densityAtExpected).toBeCloseTo(0.5, 5);
  });

  it("goes negative on headroom when the field is too small", () => {
    const verdict = crowdVerdict({
      expected: 30000,
      area,
      density: "comfortable",
    });
    expect(verdict.headroom).toBeLessThan(0);
  });

  it("reports a clearance time when it knows the exits", () => {
    const verdict = crowdVerdict({
      expected: 8200,
      area,
      density: "comfortable",
      exits: 5,
    });
    expect(verdict.clearanceMinutes).toBeCloseTo(
      8200 / (5 * EXIT_RATE_PER_MINUTE),
      5,
    );
  });

  it("leaves the clearance off without exits", () => {
    const verdict = crowdVerdict({ expected: 100, area, density: "dense" });
    expect(verdict.clearanceMinutes).toBeUndefined();
  });

  it("takes another exit rate", () => {
    const slow = crowdVerdict({
      expected: 1000,
      area,
      density: "dense",
      exits: 2,
      exitRate: 10,
    });
    expect(slow.clearanceMinutes).toBe(50);
  });
});

describe("checkCrowd", () => {
  it("passes a comfortable plan", () => {
    const diagnostics = checkCrowd({
      expected: 5000,
      area,
      density: "comfortable",
      exits: 8,
    });
    expect(diagnostics.size).toBe(0);
  });

  it("fails a field that cannot hold the crowd", () => {
    const diagnostics = checkCrowd({
      expected: 30000,
      area,
      density: "comfortable",
      exits: 20,
    });
    expect(diagnostics.byCode("PF4300")[0]?.help).toContain("cap the numbers");
  });

  it("warns when the field is nearly full", () => {
    const diagnostics = checkCrowd({
      expected: 19500,
      area,
      density: "comfortable",
      exits: 20,
    });
    expect(diagnostics.byCode("PF4301")).toHaveLength(1);
    expect(diagnostics.hasErrors()).toBe(false);
  });

  it("fails a density past what is a viewing area", () => {
    const diagnostics = checkCrowd({
      expected: 60000,
      area,
      density: "packed",
      exits: 40,
    });
    expect(diagnostics.byCode("PF4302")[0]?.help).toContain(
      "stops being a viewing area",
    );
  });

  it("warns when no exits are given", () => {
    const diagnostics = checkCrowd({
      expected: 100,
      area,
      density: "comfortable",
    });
    expect(diagnostics.byCode("PF4303")).toHaveLength(1);
  });

  it("warns about a clearance that takes too long", () => {
    const diagnostics = checkCrowd({
      expected: 10000,
      area,
      density: "comfortable",
      exits: 2,
    });
    expect(diagnostics.byCode("PF4304")[0]?.help).toContain("eight minutes");
  });
});

describe("depthNeeded", () => {
  it("says how far back the area has to run", () => {
    expect(depthNeeded(10000, metres(200), "comfortable")).toBe(25);
  });

  it("needs less depth at a higher density", () => {
    expect(depthNeeded(10000, metres(200), "dense")).toBeLessThan(
      depthNeeded(10000, metres(200), "comfortable"),
    );
  });

  it("cannot fit anybody behind no frontage", () => {
    expect(depthNeeded(100, metres(0))).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("insideViewingArea", () => {
  const line = straightLine("line", point(-100, -50), point(100, -50));

  it("puts a point close to the line inside", () => {
    expect(insideViewingArea(point(0, -70), line, metres(30))).toBe(true);
  });

  it("puts a point beyond the depth outside", () => {
    expect(insideViewingArea(point(0, -120), line, metres(30))).toBe(false);
  });

  it("measures to the nearest segment of a polyline", () => {
    const bent = boundary("bent", [
      point(-100, -50),
      point(0, -50),
      point(0, 50),
    ]);
    expect(insideViewingArea(point(10, 20), bent, metres(20))).toBe(true);
  });
});

describe("describeCrowd", () => {
  it("reads as a table with the density spelled out", () => {
    const text = describeCrowd({
      expected: 5000,
      area,
      density: "comfortable",
      exits: 8,
    });
    expect(text).toContain("frontage");
    expect(text).toContain("per square metre");
    expect(text).toContain("clearance");
  });

  it("leaves the clearance row out without exits", () => {
    expect(
      describeCrowd({ expected: 500, area, density: "dense" }),
    ).not.toContain("clearance");
  });
});

describe("the crowd command", () => {
  it("reports capacity for a field", () => {
    const env = new MemoryEnv();
    expect(
      main(
        [
          "crowd",
          "--frontage",
          "200",
          "--depth",
          "50",
          "--expected",
          "5000",
          "--exits",
          "8",
        ],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("capacity");
    expect(env.stdout).toContain("at every density");
  });

  it("fails a field that cannot hold the crowd", () => {
    const env = new MemoryEnv();
    expect(
      main(
        ["crowd", "--frontage", "50", "--depth", "20", "--expected", "9000"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF4300");
  });

  it("says how deep the area needs to be", () => {
    const env = new MemoryEnv();
    expect(
      main(
        ["crowd", "--frontage", "200", "--expected", "10000", "--depth-for"],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("need 25m of depth");
  });

  it("needs a frontage and a headcount", () => {
    const env = new MemoryEnv();
    expect(main(["crowd", "--depth", "50"], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("--frontage needs a value");
  });

  it("needs a depth unless it is being asked for one", () => {
    const env = new MemoryEnv();
    expect(main(["crowd", "--frontage", "200", "--expected", "100"], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("--depth needs a value");
  });

  it("refuses a density it does not know", () => {
    const env = new MemoryEnv();
    expect(
      main(
        [
          "crowd",
          "--frontage",
          "200",
          "--depth",
          "50",
          "--expected",
          "100",
          "--density",
          "sardines",
        ],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
  });
});
