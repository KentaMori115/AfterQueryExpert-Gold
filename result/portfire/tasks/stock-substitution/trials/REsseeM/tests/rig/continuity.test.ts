import { describe, expect, it } from "vitest";
import { matchNamed } from "../../src/rig/circuit.js";
import {
  checkReconciliation,
  checkResistances,
  parseContinuity,
  reconcile,
  resistanceLooksRight,
  unwalkedPins,
} from "../../src/rig/continuity.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { pinAddress } from "../../src/rig/pin.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { positionId } from "../../src/core/ids.js";
import { ohms } from "../../src/core/units.js";

const standard = matchNamed("standard")!;

describe("parseContinuity", () => {
  it("reads a plain dump", () => {
    const report = parseContinuity(
      ["pin,state", "01.01,ok", "01.02,open"].join("\n"),
      "walk.csv",
    );
    expect(report.diagnostics.size).toBe(0);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]?.reading).toBe("connected");
    expect(report.rows[1]?.reading).toBe("open");
  });

  it("takes any of the pin column spellings", () => {
    for (const header of ["pin", "address", "cue", "output"]) {
      const report = parseContinuity(`${header},state\n01.01,ok`, "w.csv");
      expect(report.rows).toHaveLength(1);
    }
  });

  it("takes any of the state column spellings", () => {
    for (const header of ["state", "reading", "status", "continuity"]) {
      const report = parseContinuity(`pin,${header}\n01.01,ok`, "w.csv");
      expect(report.rows).toHaveLength(1);
    }
  });

  it("reads every spelling of a reading", () => {
    const report = parseContinuity(
      ["pin,state", "01.01,GOOD", "01.02,no", "01.03,shorted"].join("\n"),
      "w.csv",
    );
    expect(report.rows.map((row) => row.reading)).toEqual([
      "connected",
      "open",
      "short",
    ]);
  });

  it("reads a resistance when the dump has one", () => {
    const report = parseContinuity(
      ["pin,state,ohms", "01.01,ok,3.4"].join("\n"),
      "w.csv",
    );
    expect(report.rows[0]?.resistance).toBeDefined();
  });

  it("leaves the resistance off when it is blank or nonsense", () => {
    const report = parseContinuity(
      ["pin,state,ohms", "01.01,ok,", "01.02,ok,lots"].join("\n"),
      "w.csv",
    );
    expect("resistance" in (report.rows[0] ?? {})).toBe(false);
    expect("resistance" in (report.rows[1] ?? {})).toBe(false);
  });

  it("refuses a dump with no usable columns", () => {
    const report = parseContinuity("a,b\n1,2", "w.csv");
    expect(report.diagnostics.byCode("PF1400")[0]?.help).toContain("address");
  });

  it("refuses a row with an unreadable pin", () => {
    const report = parseContinuity("pin,state\nnowhere,ok", "w.csv");
    expect(report.diagnostics.byCode("PF1401")).toHaveLength(1);
  });

  it("refuses a row with a state it does not know", () => {
    const report = parseContinuity("pin,state\n01.01,maybe", "w.csv");
    expect(report.diagnostics.byCode("PF1402")[0]?.message).toContain("maybe");
  });

  it("keeps reading after a bad row", () => {
    const report = parseContinuity(
      ["pin,state", "nowhere,ok", "01.02,ok"].join("\n"),
      "w.csv",
    );
    expect(report.rows).toHaveLength(1);
  });
});

describe("reconcile", () => {
  const expected = [pinAddress(1, 1), pinAddress(1, 2), pinAddress(1, 3)];

  it("finds nothing wrong with a matching walk", () => {
    const rows = parseContinuity(
      ["pin,state", "01.01,ok", "01.02,ok", "01.03,ok"].join("\n"),
      "w.csv",
    ).rows;
    const result = reconcile(expected, rows);
    expect(result.dead).toEqual([]);
    expect(result.stray).toEqual([]);
    expect(result.unreported).toEqual([]);
  });

  it("finds a cue that will not go", () => {
    const rows = parseContinuity(
      ["pin,state", "01.01,ok", "01.02,open", "01.03,ok"].join("\n"),
      "w.csv",
    ).rows;
    expect(reconcile(expected, rows).dead).toEqual([pinAddress(1, 2)]);
  });

  it("finds a lead on a pin nothing fires", () => {
    const rows = parseContinuity(
      ["pin,state", "01.01,ok", "01.02,ok", "01.03,ok", "01.09,ok"].join("\n"),
      "w.csv",
    ).rows;
    expect(reconcile(expected, rows).stray).toEqual([pinAddress(1, 9)]);
  });

  it("does not call an unused open pin stray", () => {
    const rows = parseContinuity(
      ["pin,state", "01.01,ok", "01.02,ok", "01.03,ok", "01.09,open"].join(
        "\n",
      ),
      "w.csv",
    ).rows;
    expect(reconcile(expected, rows).stray).toEqual([]);
  });

  it("finds a short whether the show uses the pin or not", () => {
    const rows = parseContinuity(
      ["pin,state", "01.01,short", "01.09,short"].join("\n"),
      "w.csv",
    ).rows;
    expect(reconcile(expected, rows).shorted).toHaveLength(2);
  });

  it("finds a pin the walk never reached", () => {
    const rows = parseContinuity("pin,state\n01.01,ok", "w.csv").rows;
    expect(reconcile(expected, rows).unreported).toEqual([
      pinAddress(1, 2),
      pinAddress(1, 3),
    ]);
  });

  it("sorts each list by pin", () => {
    const rows = parseContinuity(
      ["pin,state", "01.03,open", "01.01,open"].join("\n"),
      "w.csv",
    ).rows;
    expect(reconcile(expected, rows).dead).toEqual([
      pinAddress(1, 1),
      pinAddress(1, 3),
    ]);
  });
});

describe("checkReconciliation", () => {
  it("says nothing about a clean walk", () => {
    const clean = { dead: [], stray: [], shorted: [], unreported: [] };
    expect(checkReconciliation(clean).size).toBe(0);
  });

  it("errors on a dead cue, a short and a stray lead", () => {
    const result = {
      dead: [pinAddress(1, 1)],
      stray: [pinAddress(1, 9)],
      shorted: [pinAddress(1, 5)],
      unreported: [pinAddress(1, 7)],
    };
    const diagnostics = checkReconciliation(result);
    expect(diagnostics.byCode("PF1410")).toHaveLength(1);
    expect(diagnostics.byCode("PF1411")).toHaveLength(1);
    expect(diagnostics.byCode("PF1412")).toHaveLength(1);
    expect(diagnostics.byCode("PF1413")).toHaveLength(1);
    expect(diagnostics.errorCount).toBe(3);
  });

  it("explains why a stray lead matters", () => {
    const result = {
      dead: [],
      stray: [pinAddress(1, 9)],
      shorted: [],
      unreported: [],
    };
    expect(checkReconciliation(result).byCode("PF1412")[0]?.help).toContain(
      "one terminal out",
    );
  });
});

describe("resistances", () => {
  const lead = ohms(3);

  it("accepts a reading close to what the circuit should give", () => {
    expect(
      resistanceLooksRight(ohms(4.9), { matches: 1, spec: standard, lead }),
    ).toBe(true);
  });

  it("rejects a reading well off", () => {
    expect(
      resistanceLooksRight(ohms(9), { matches: 1, spec: standard, lead }),
    ).toBe(false);
  });

  it("warns about a joint that reads high", () => {
    const rows = parseContinuity(
      ["pin,state,ohms", "01.01,ok,9.0", "01.02,ok,4.9"].join("\n"),
      "w.csv",
    ).rows;
    const diagnostics = checkResistances(rows, standard, lead, 24);
    expect(diagnostics.byCode("PF1414")).toHaveLength(1);
    expect(diagnostics.byCode("PF1414")[0]?.message).toContain("01.01");
  });

  it("ignores a row with no resistance or an open pin", () => {
    const rows = parseContinuity(
      ["pin,state,ohms", "01.01,ok,", "01.02,open,90"].join("\n"),
      "w.csv",
    ).rows;
    expect(checkResistances(rows, standard, lead, 24).size).toBe(0);
  });
});

describe("unwalkedPins", () => {
  it("names the pins the walk never covered", () => {
    const rig = Rig.from(
      [firingPosition(positionId("pad.a"), 0, 0)],
      [firingModule(1, modelNamed("fc-16")!, positionId("pad.a"))],
    );
    const rows = parseContinuity("pin,state\n01.01,ok", "w.csv").rows;
    expect(unwalkedPins(rig, rows)).toHaveLength(15);
  });
});
