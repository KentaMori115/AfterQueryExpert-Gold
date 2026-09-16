import { describe, expect, it } from "vitest";
import {
  MATCHES,
  circuitResistance,
  describeCircuit,
  firingCurrent,
  leadResistance,
  matchNamed,
  maxSeriesMatches,
  parallelImbalance,
  parallelShare,
  verdictFor,
} from "../../src/rig/circuit.js";
import { amperes, ohms, raw } from "../../src/core/units.js";

const standard = matchNamed("standard")!;

describe("match specs", () => {
  it("finds one by name, ignoring case", () => {
    expect(matchNamed("STANDARD")?.name).toBe("standard");
    expect(matchNamed("nothing")).toBeUndefined();
  });

  it("always puts all fire above no fire", () => {
    for (const spec of MATCHES) {
      expect(raw(spec.allFire)).toBeGreaterThan(raw(spec.noFire));
      expect(raw(spec.resistance)).toBeGreaterThan(0);
    }
  });
});

describe("leadResistance", () => {
  it("counts both legs of the run", () => {
    expect(raw(leadResistance(50))).toBeCloseTo(7, 6);
  });

  it("takes a different wire gauge", () => {
    expect(raw(leadResistance(50, 0.02))).toBeCloseTo(2, 6);
  });

  it("is nothing for no lead at all", () => {
    expect(raw(leadResistance(0))).toBe(0);
  });

  it("refuses a negative length", () => {
    expect(() => leadResistance(-1)).toThrow(/negative/);
  });
});

describe("circuitResistance", () => {
  it("adds the matches and the lead", () => {
    const circuit = { matches: 5, spec: standard, lead: ohms(3) };
    expect(raw(circuitResistance(circuit))).toBeCloseTo(12.5, 6);
  });

  it("is just the lead when nothing is wired on", () => {
    const circuit = { matches: 0, spec: standard, lead: ohms(3) };
    expect(raw(circuitResistance(circuit))).toBe(3);
  });
});

describe("firingCurrent", () => {
  it("is voltage over resistance", () => {
    const circuit = { matches: 1, spec: standard, lead: ohms(0.1) };
    expect(raw(firingCurrent(circuit, 20))).toBeCloseTo(10, 3);
  });

  it("falls as matches are added in series", () => {
    const one = firingCurrent(
      { matches: 1, spec: standard, lead: ohms(1) },
      24,
    );
    const ten = firingCurrent(
      { matches: 10, spec: standard, lead: ohms(1) },
      24,
    );
    expect(raw(ten)).toBeLessThan(raw(one));
  });

  it("refuses a dead short", () => {
    expect(() =>
      firingCurrent({ matches: 0, spec: standard, lead: ohms(0) }, 24),
    ).toThrow(/short/);
  });
});

describe("verdictFor", () => {
  it("fires a single match comfortably", () => {
    expect(verdictFor({ matches: 1, spec: standard, lead: ohms(2) }, 24)).toBe(
      "fires",
    );
  });

  it("fires a reasonable series chain", () => {
    expect(verdictFor({ matches: 8, spec: standard, lead: ohms(3) }, 24)).toBe(
      "fires",
    );
  });

  it("calls out the band between no fire and all fire", () => {
    const circuit = { matches: 1, spec: standard, lead: ohms(60) };
    expect(verdictFor(circuit, 24)).toBe("marginal");
  });

  it("refuses a circuit that cannot light anything", () => {
    const circuit = { matches: 1, spec: standard, lead: ohms(400) };
    expect(verdictFor(circuit, 24)).toBe("will-not-fire");
  });
});

describe("maxSeriesMatches", () => {
  it("says how many will still all fire", () => {
    expect(maxSeriesMatches(standard, ohms(3), 24)).toBe(16);
  });

  it("allows fewer on a longer lead", () => {
    expect(maxSeriesMatches(standard, ohms(20), 24)).toBeLessThan(
      maxSeriesMatches(standard, ohms(3), 24),
    );
  });

  it("allows more at a higher voltage", () => {
    expect(maxSeriesMatches(standard, ohms(3), 36)).toBeGreaterThan(
      maxSeriesMatches(standard, ohms(3), 24),
    );
  });

  it("never goes below zero", () => {
    expect(maxSeriesMatches(standard, ohms(500), 24)).toBe(0);
  });
});

describe("parallel branches", () => {
  it("splits evenly between equal branches", () => {
    const [a, b] = parallelShare(ohms(2), ohms(2), amperes(1));
    expect(raw(a)).toBeCloseTo(0.5, 6);
    expect(raw(b)).toBeCloseTo(0.5, 6);
  });

  it("gives the lower resistance branch the larger share", () => {
    const [a, b] = parallelShare(ohms(1), ohms(3), amperes(1));
    expect(raw(a)).toBeGreaterThan(raw(b));
  });

  it("measures how uneven the split is", () => {
    expect(parallelImbalance(ohms(2), ohms(2))).toBeCloseTo(0, 6);
    expect(parallelImbalance(ohms(1), ohms(3))).toBeCloseTo(2 / 3, 6);
  });

  it("refuses a branch with no resistance", () => {
    expect(() => parallelShare(ohms(0), ohms(2), amperes(1))).toThrow(
      /real resistance/,
    );
  });
});

describe("describeCircuit", () => {
  it("reads as one line on a continuity sheet", () => {
    const circuit = { matches: 5, spec: standard, lead: ohms(3) };
    expect(describeCircuit(circuit, 24)).toBe(
      "5 x standard, 12.5 ohm, 1.92 A, fires",
    );
  });
});
