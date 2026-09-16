import { verifyExpect } from "../support/frozenExpect.js";
import { describe, expect, it } from "vitest";
import {
  Catalog,
  GROUND_WAIT,
  MORTAR_WAIT,
  Rig,
  calibre,
  checkAfterWalk,
  checkLog,
  clearAt,
  clearancePlan,
  compile,
  effectId,
  firingModule,
  firingPosition,
  formatPin,
  gradeLog,
  metres,
  misfiresIn,
  mm,
  modelNamed,
  ms,
  parseContinuity,
  parsePanelLog,
  pinAddress,
  planRefires,
  positionId,
  raw,
  reconcileAfter,
  shell,
  unfiredPins,
} from "../../src/index.js";
import type {
  CompileOptions,
  GroundPiece,
  Mine,
  PanelLogRow,
  PinAddress,
  QuantisedSchedule,
} from "../../src/index.js";

const mine: Mine = {
  kind: "mine",
  id: effectId("mine.100"),
  name: "mine",
  calibre: calibre(mm(100)),
  spreadAngle: 40,
  height: metres(35),
  hangTime: ms(1800),
};
const gerb: GroundPiece = {
  kind: "ground",
  id: effectId("gerb.crackle"),
  name: "gerb",
  style: "gerb",
  duration: ms(20000),
  height: metres(4),
};
const catalog = Catalog.from([
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  mine,
  gerb,
]);
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 40, 0),
  ],
  [
    firingModule(1, modelNamed("fc-32")!, positionId("pad.a")),
    firingModule(2, modelNamed("fc-16")!, positionId("pad.b")),
  ],
);

function show(
  lines: readonly string[],
  extra: Partial<CompileOptions> = {},
): QuantisedSchedule {
  const result = compile(lines.join("\n"), "show.pf", {
    catalog,
    rig,
    ...extra,
  });
  expect(result.diagnostics.errorCount).toBe(0);
  return result.schedule;
}

/** A row for a show pin at the time the table expects, plus a shift. */
function rowFor(
  schedule: QuantisedSchedule,
  pin: string,
  shiftMs = 0,
  line = 2,
): PanelLogRow {
  const event = schedule.events.find((e) => formatPin(e.address) === pin);
  if (event === undefined) {
    throw new Error(`no event on ${pin}`);
  }
  return {
    address: event.address,
    at: ms(raw(event.ignitionAt) + raw(schedule.preRoll) + shiftMs),
    line,
  };
}

const pins = (list: readonly PinAddress[]): string[] => list.map(formatPin);

// A show whose opener has to go up before the music: a six inch at two
// seconds needs just over four seconds of lead, so the table starts before
// zero and the panel runs a pre roll.
const PREROLL_SHOW = [
  "at 2 fire shell.150 from pad.a",
  "at 10 fire mine.100 from pad.a",
  "at 20 fire gerb.crackle from pad.b",
];

// The same three without the opener, so nothing fires before zero.
const PLAIN_SHOW = [
  "at 10 fire mine.100 from pad.a",
  "at 12 fire mine.100 from pad.a",
  "at 20 fire gerb.crackle from pad.b",
];

describe("parsePanelLog", () => {
  it("reads a pin column and a time column written like cue times", () => {
    verifyExpect();
    const report = parsePanelLog(
      ["pin,fired", "01.01,12.4", "01.02,1:23.450", "02.01,250ms"].join("\n"),
      "log.csv",
    );
    expect(report.diagnostics.size).toBe(0);
    expect(report.rows.map((row) => formatPin(row.address))).toEqual([
      "01.01",
      "01.02",
      "02.01",
    ]);
    expect(report.rows.map((row) => raw(row.at))).toEqual([12400, 83450, 250]);
  });

  it("takes every spelling of the pin column", () => {
    for (const header of ["pin", "address", "cue", "output"]) {
      const report = parsePanelLog(`${header},time\n01.01,4.0`, "log.csv");
      expect(report.rows).toHaveLength(1);
      expect(report.diagnostics.size).toBe(0);
    }
  });

  it("takes every spelling of the time column", () => {
    for (const header of ["time", "fired", "at", "fired at"]) {
      const report = parsePanelLog(`pin,${header}\n01.01,4.0`, "log.csv");
      expect(report.rows).toHaveLength(1);
      expect(raw(report.rows[0]!.at)).toBe(4000);
    }
  });

  it("refuses a file without both columns", () => {
    const report = parsePanelLog("cue,state\n01.01,ok", "log.csv");
    expect(report.rows).toEqual([]);
    expect(report.diagnostics.hasErrors()).toBe(true);
  });

  it("reports a row that will not read and keeps reading", () => {
    const report = parsePanelLog(
      ["pin,time", "01.01,4.0", "nonsense,5.0", "01.03,soon", "01.04,6.0"].join(
        "\n",
      ),
      "log.csv",
    );
    expect(report.rows.map((row) => formatPin(row.address))).toEqual([
      "01.01",
      "01.04",
    ]);
    expect(report.diagnostics.errorCount).toBe(2);
  });
});

describe("gradeLog on the panel's clock", () => {
  it("takes the pre roll off a log time before comparing", () => {
    verifyExpect();
    const schedule = show(PREROLL_SHOW);
    expect(raw(schedule.preRoll)).toBe(2030);
    const opener = schedule.events[0]!;
    expect(formatPin(opener.address)).toBe("01.01");
    expect(raw(opener.ignitionAt)).toBe(-2040);
    // The panel logged the opener at its own zero.
    const grade = gradeLog(schedule, [
      { address: opener.address, at: ms(0), line: 2 },
      rowFor(schedule, "01.02"),
      rowFor(schedule, "02.01"),
    ]);
    expect(grade.missed).toEqual([]);
    expect(grade.extra).toEqual([]);
    expect(grade.fired).toHaveLength(3);
    expect(raw(grade.fired[0]!.offset)).toBe(10);
    expect(grade.late).toEqual([]);
    expect(grade.early).toEqual([]);
  });

  it("reads a log written in show time as early by the whole pre roll", () => {
    const schedule = show(PREROLL_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01", -2030),
      rowFor(schedule, "01.02", -2030),
      rowFor(schedule, "02.01", -2030),
    ]);
    expect(grade.early).toHaveLength(3);
    expect(grade.early.map((match) => raw(match.offset))).toEqual([
      -2030, -2030, -2030,
    ]);
  });

  it("has nothing to take off once the pre roll is absorbed", () => {
    const schedule = show(PREROLL_SHOW, { absorbPreRoll: true });
    expect(raw(schedule.preRoll)).toBe(0);
    const first = schedule.events[0]!;
    const grade = gradeLog(schedule, [
      { address: first.address, at: first.ignitionAt, line: 2 },
    ]);
    expect(raw(grade.fired[0]!.offset)).toBe(0);
  });

  it("carries the event and the row on each match", () => {
    const schedule = show(PLAIN_SHOW);
    const row = rowFor(schedule, "01.02", 5, 7);
    const grade = gradeLog(schedule, [row]);
    expect(grade.fired[0]!.row).toEqual(row);
    expect(grade.fired[0]!.event.effectId).toBe("mine.100");
    expect(raw(grade.fired[0]!.offset)).toBe(5);
  });
});

describe("gradeLog matching", () => {
  it("lists a show pin the log never mentions as missed, in table order", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [rowFor(schedule, "01.02")]);
    expect(pins(grade.missed.map((event) => event.address))).toEqual([
      "01.01",
      "02.01",
    ]);
    expect(grade.fired).toHaveLength(1);
  });

  it("keeps fired in the table's firing order whatever the log's order", () => {
    verifyExpect();
    const schedule = show(PLAIN_SHOW);
    // The first pin closed so late that the panel logged it after the second.
    const grade = gradeLog(schedule, [
      rowFor(schedule, "02.01"),
      rowFor(schedule, "01.02"),
      rowFor(schedule, "01.01", 3000),
    ]);
    expect(pins(grade.fired.map((match) => match.event.address))).toEqual([
      "01.01",
      "01.02",
      "02.01",
    ]);
  });

  it("calls a row for a pin the show never fires extra whatever its time", () => {
    const schedule = show(PLAIN_SHOW);
    const stray = { address: pinAddress(1, 9), at: ms(9970), line: 5 };
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01"),
      rowFor(schedule, "01.02"),
      rowFor(schedule, "02.01"),
      stray,
    ]);
    expect(grade.extra).toEqual([stray]);
    expect(grade.missed).toEqual([]);
  });

  it("takes the earliest logged time as the firing and the rest as extra", () => {
    const schedule = show(PLAIN_SHOW);
    const later = rowFor(schedule, "01.01", 500, 2);
    const earlier = rowFor(schedule, "01.01", 0, 3);
    const grade = gradeLog(schedule, [
      later,
      earlier,
      rowFor(schedule, "01.02"),
      rowFor(schedule, "02.01"),
    ]);
    expect(grade.fired.map((match) => match.row)).toContainEqual(earlier);
    expect(grade.extra).toEqual([later]);
    expect(raw(grade.fired[0]!.offset)).toBe(0);
    expect(grade.late).toEqual([]);
  });

  it("grades an empty log as every pin missed", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, []);
    expect(grade.missed).toHaveLength(3);
    expect(grade.fired).toEqual([]);
    expect(grade.worst).toBeUndefined();
  });
});

describe("gradeLog tolerance", () => {
  it("allows one frame of the show's format either way", () => {
    verifyExpect();
    const schedule = show(PLAIN_SHOW);
    expect(schedule.format.rate).toBe(25);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01", 40),
      rowFor(schedule, "01.02", -40),
      rowFor(schedule, "02.01", 41),
    ]);
    expect(grade.late.map((match) => formatPin(match.event.address))).toEqual([
      "02.01",
    ]);
    expect(grade.early).toEqual([]);
  });

  it("follows the frame rate the script names", () => {
    const schedule = show(["frame 30", ...PLAIN_SHOW]);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01", 34),
      rowFor(schedule, "01.02", -34),
      rowFor(schedule, "02.01", 33),
    ]);
    expect(grade.late).toHaveLength(1);
    expect(grade.early).toHaveLength(1);
    expect(formatPin(grade.early[0]!.event.address)).toBe("01.02");
  });

  it("takes a tolerance of its own", () => {
    const schedule = show(PLAIN_SHOW);
    const rows = [
      rowFor(schedule, "01.01", 120),
      rowFor(schedule, "01.02", -1),
      rowFor(schedule, "02.01"),
    ];
    const strict = gradeLog(schedule, rows, { tolerance: ms(0) });
    expect(strict.late).toHaveLength(1);
    expect(strict.early).toHaveLength(1);
    const loose = gradeLog(schedule, rows, { tolerance: ms(200) });
    expect(loose.late).toEqual([]);
    expect(loose.early).toEqual([]);
  });

  it("names the match furthest from its time, either way", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01", 80),
      rowFor(schedule, "01.02", -90),
      rowFor(schedule, "02.01", 3),
    ]);
    expect(formatPin(grade.worst!.event.address)).toBe("01.02");
    expect(raw(grade.worst!.offset)).toBe(-90);
  });
});

describe("checkLog", () => {
  it("says nothing about a log that matches the table", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01"),
      rowFor(schedule, "01.02"),
      rowFor(schedule, "02.01"),
    ]);
    expect(checkLog(grade).size).toBe(0);
  });

  it("makes a missed output an error", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01"),
      rowFor(schedule, "02.01"),
    ]);
    const bag = checkLog(grade);
    expect(bag.size).toBe(1);
    expect(bag.errorCount).toBe(1);
  });

  it("makes an extra output an error", () => {
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01"),
      rowFor(schedule, "01.02"),
      rowFor(schedule, "02.01"),
      { address: pinAddress(2, 7), at: ms(1000), line: 9 },
    ]);
    const bag = checkLog(grade);
    expect(bag.size).toBe(1);
    expect(bag.errorCount).toBe(1);
  });

  it("makes a late or an early output a warning, not an error", () => {
    verifyExpect();
    const schedule = show(PLAIN_SHOW);
    const grade = gradeLog(schedule, [
      rowFor(schedule, "01.01", 300),
      rowFor(schedule, "01.02", -300),
      rowFor(schedule, "02.01"),
    ]);
    const bag = checkLog(grade);
    expect(bag.size).toBe(2);
    expect(bag.warningCount).toBe(2);
    expect(bag.hasErrors()).toBe(false);
  });
});

function rows(text: string) {
  const report = parseContinuity(text, "walk.csv");
  expect(report.diagnostics.size).toBe(0);
  return report.rows;
}

describe("reconcileAfter", () => {
  const expected = [pinAddress(1, 1), pinAddress(1, 2), pinAddress(2, 1)];

  it("calls a show pin that reads open fired", () => {
    verifyExpect();
    const result = reconcileAfter(
      expected,
      undefined,
      rows("pin,state\n01.01,open\n01.02,open\n02.01,open"),
    );
    expect(pins(result.fired)).toEqual(["01.01", "01.02", "02.01"]);
    expect(result.misfired).toEqual([]);
    expect(result.dead).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.shorted).toEqual([]);
    expect(result.burnt).toEqual([]);
  });

  it("calls a show pin still connected a misfire", () => {
    const result = reconcileAfter(
      expected,
      undefined,
      rows("pin,state\n01.01,open\n01.02,ok\n02.01,open"),
    );
    expect(pins(result.misfired)).toEqual(["01.02"]);
    expect(pins(result.fired)).toEqual(["01.01", "02.01"]);
  });

  it("calls it dead instead when the first walk already read it open", () => {
    const before = rows("pin,state\n01.01,ok\n01.02,open\n02.01,ok");
    const after = rows("pin,state\n01.01,open\n01.02,ok\n02.01,ok");
    const result = reconcileAfter(expected, before, after);
    expect(pins(result.dead)).toEqual(["01.02"]);
    expect(pins(result.misfired)).toEqual(["02.01"]);
    expect(pins(result.fired)).toEqual(["01.01"]);
  });

  it("does not call anything dead without the first walk", () => {
    const after = rows("pin,state\n01.01,open\n01.02,ok\n02.01,ok");
    const result = reconcileAfter(expected, undefined, after);
    expect(result.dead).toEqual([]);
    expect(pins(result.misfired)).toEqual(["01.02", "02.01"]);
  });

  it("treats a pin the first walk skipped as a misfire, not dead", () => {
    const before = rows("pin,state\n01.01,ok");
    const after = rows("pin,state\n01.01,open\n01.02,ok\n02.01,open");
    const result = reconcileAfter(expected, before, after);
    expect(result.dead).toEqual([]);
    expect(pins(result.misfired)).toEqual(["01.02"]);
  });

  it("calls a show pin the after walk never reported unknown", () => {
    const result = reconcileAfter(
      expected,
      undefined,
      rows("pin,state\n01.01,open"),
    );
    expect(pins(result.unknown)).toEqual(["01.02", "02.01"]);
    expect(pins(result.fired)).toEqual(["01.01"]);
  });

  it("lists a show pin reading short", () => {
    const result = reconcileAfter(
      expected,
      undefined,
      rows("pin,state\n01.01,short\n01.02,open\n02.01,open"),
    );
    expect(pins(result.shorted)).toEqual(["01.01"]);
    expect(result.misfired).toEqual([]);
  });

  it("calls a pin outside the show burnt when it went from connected to open", () => {
    verifyExpect();
    const before = rows("pin,state\n01.01,ok\n01.02,ok\n02.01,ok\n01.09,ok");
    const after = rows(
      "pin,state\n01.01,open\n01.02,open\n02.01,open\n01.09,open",
    );
    const result = reconcileAfter(expected, before, after);
    expect(pins(result.burnt)).toEqual(["01.09"]);
    expect(pins(result.fired)).toEqual(["01.01", "01.02", "02.01"]);
  });

  it("does not call an outside pin burnt when it read open both times", () => {
    const before = rows("pin,state\n01.01,ok\n01.09,open");
    const after = rows("pin,state\n01.01,open\n01.09,open");
    expect(reconcileAfter(expected, before, after).burnt).toEqual([]);
  });

  it("cannot call anything burnt without the first walk", () => {
    const after = rows("pin,state\n01.01,open\n01.09,open");
    expect(reconcileAfter(expected, undefined, after).burnt).toEqual([]);
  });

  it("sorts every list by pin", () => {
    const order = ["01.02", "01.05", "02.03"];
    const wanted = [pinAddress(2, 3), pinAddress(1, 5), pinAddress(1, 2)];
    const after = rows("pin,state\n02.03,ok\n01.05,ok\n01.02,ok");
    const result = reconcileAfter(wanted, undefined, after);
    expect(pins(result.misfired)).toEqual(order);
    const missing = reconcileAfter(wanted, undefined, rows("pin,state"));
    expect(pins(missing.unknown)).toEqual(order);
    const lit = reconcileAfter(
      wanted,
      undefined,
      rows("pin,state\n02.03,open\n01.05,open\n01.02,open"),
    );
    expect(pins(lit.fired)).toEqual(order);
    const shorts = reconcileAfter(
      wanted,
      undefined,
      rows("pin,state\n02.03,short\n01.05,short\n01.02,short"),
    );
    expect(pins(shorts.shorted)).toEqual(order);
    const gone = reconcileAfter(
      wanted,
      rows("pin,state\n02.03,open\n01.05,open\n01.02,open"),
      rows("pin,state\n02.03,ok\n01.05,ok\n01.02,ok"),
    );
    expect(pins(gone.dead)).toEqual(order);
    const strays = reconcileAfter(
      wanted,
      rows("pin,state\n02.09,ok\n01.09,ok\n01.07,ok"),
      rows("pin,state\n02.09,open\n01.09,open\n01.07,open"),
    );
    expect(pins(strays.burnt)).toEqual(["01.07", "01.09", "02.09"]);
  });
});

describe("unfiredPins", () => {
  it("is everything but fired, by pin", () => {
    const expected = [
      pinAddress(1, 1),
      pinAddress(1, 2),
      pinAddress(1, 3),
      pinAddress(1, 4),
      pinAddress(1, 5),
    ];
    const before = rows("pin,state\n01.01,ok\n01.02,ok\n01.03,open\n01.05,ok");
    const after = rows(
      "pin,state\n01.05,ok\n01.03,ok\n01.02,short\n01.01,open",
    );
    const result = reconcileAfter(expected, before, after);
    expect(pins(unfiredPins(result))).toEqual([
      "01.02",
      "01.03",
      "01.04",
      "01.05",
    ]);
  });
});

describe("checkAfterWalk", () => {
  const expected = [pinAddress(1, 1), pinAddress(1, 2)];

  it("says nothing when everything fired", () => {
    const result = reconcileAfter(
      expected,
      undefined,
      rows("pin,state\n01.01,open\n01.02,open"),
    );
    expect(checkAfterWalk(result).size).toBe(0);
  });

  it("makes a dead cue an error", () => {
    const before = rows("pin,state\n01.01,ok\n01.02,open");
    const after = rows("pin,state\n01.01,open\n01.02,ok");
    const bag = checkAfterWalk(reconcileAfter(expected, before, after));
    expect(bag.size).toBe(1);
    expect(bag.errorCount).toBe(1);
  });

  it("makes a burnt stray an error", () => {
    const before = rows("pin,state\n01.01,ok\n01.02,ok\n01.07,ok");
    const after = rows("pin,state\n01.01,open\n01.02,open\n01.07,open");
    const bag = checkAfterWalk(reconcileAfter(expected, before, after));
    expect(bag.size).toBe(1);
    expect(bag.errorCount).toBe(1);
  });

  it("makes a pin nobody walked a warning", () => {
    verifyExpect();
    const after = rows("pin,state\n01.01,open");
    const bag = checkAfterWalk(reconcileAfter(expected, undefined, after));
    expect(bag.size).toBe(1);
    expect(bag.warningCount).toBe(1);
    expect(bag.hasErrors()).toBe(false);
  });
});

describe("clearancePlan", () => {
  // The gerb burns for twenty seconds, so it is the last light out of the
  // show even though the shell fires later than nothing.
  const schedule = show([
    "at 20 fire shell.150 from pad.a",
    "at 25 fire gerb.crackle from pad.b",
    "at 30 fire mine.100 from pad.a",
  ]);
  const lastLightOut = Math.max(
    ...schedule.events.map((event) => raw(event.occupancy.end)),
  );

  it("counts every position's wait from the show's last light out", () => {
    verifyExpect();
    const misfires = misfiresIn(schedule, [pinAddress(1, 1), pinAddress(2, 1)]);
    const plan = clearancePlan(schedule, misfires);
    expect(plan.positions.map((entry) => entry.position)).toEqual([
      "pad.b",
      "pad.a",
    ]);
    expect(raw(plan.positions[0]!.clearAt)).toBe(
      lastLightOut + raw(GROUND_WAIT),
    );
    expect(raw(plan.positions[1]!.clearAt)).toBe(
      lastLightOut + raw(MORTAR_WAIT),
    );
    expect(raw(plan.fieldClearAt)).toBe(lastLightOut + raw(MORTAR_WAIT));
    expect(raw(plan.fieldClearAt)).toBe(raw(clearAt(schedule, misfires)));
  });

  it("does not count from the position's own last cue", () => {
    const misfires = misfiresIn(schedule, [pinAddress(1, 1)]);
    const plan = clearancePlan(schedule, misfires);
    const ownEnd = raw(schedule.events[0]!.occupancy.end);
    expect(ownEnd).toBeLessThan(lastLightOut);
    expect(raw(plan.positions[0]!.clearAt)).toBe(
      lastLightOut + raw(MORTAR_WAIT),
    );
  });

  it("takes the longest wait among a position's own unfired cues", () => {
    const shared = show([
      "at 20 fire gerb.crackle from pad.a",
      "at 25 fire shell.150 from pad.a",
    ]);
    const end = Math.max(
      ...shared.events.map((event) => raw(event.occupancy.end)),
    );
    const misfires = misfiresIn(shared, [pinAddress(1, 1), pinAddress(1, 2)]);
    const plan = clearancePlan(shared, misfires);
    expect(plan.positions).toHaveLength(1);
    expect(plan.positions[0]!.misfires).toHaveLength(2);
    expect(raw(plan.positions[0]!.wait)).toBe(raw(MORTAR_WAIT));
    expect(raw(plan.positions[0]!.clearAt)).toBe(end + raw(MORTAR_WAIT));
  });

  it("has no positions and a zero field time when nothing misfired", () => {
    const plan = clearancePlan(schedule, []);
    expect(plan.positions).toEqual([]);
    expect(raw(plan.fieldClearAt)).toBe(0);
  });
});

describe("planRefires with usable pins", () => {
  const schedule = show([
    "at 20 fire gerb.crackle from pad.a",
    "at 25 fire gerb.crackle from pad.a",
    "at 30 fire shell.150 from pad.a",
  ]);

  it("skips a free pin the caller says is not usable", () => {
    verifyExpect();
    const misfires = misfiresIn(schedule, [pinAddress(1, 1)]);
    const plans = planRefires(schedule, misfires, rig, {
      usable: [pinAddress(1, 7)],
    });
    expect(plans).toHaveLength(1);
    expect(formatPin(plans[0]!.spare!)).toBe("01.07");
  });

  it("does not hand two refires one usable pin", () => {
    const misfires = misfiresIn(schedule, [pinAddress(1, 1), pinAddress(1, 2)]);
    const plans = planRefires(schedule, misfires, rig, {
      usable: [pinAddress(1, 8), pinAddress(1, 9)],
    });
    expect(plans.map((plan) => formatPin(plan.spare!))).toEqual([
      "01.08",
      "01.09",
    ]);
  });

  it("never uses a pin the show itself fires, even when called usable", () => {
    const misfires = misfiresIn(schedule, [pinAddress(1, 1)]);
    const anywhere = planRefires(schedule, misfires, rig, {
      usable: [pinAddress(1, 2), pinAddress(1, 4)],
    });
    expect(formatPin(anywhere[0]!.spare!)).toBe("01.04");
    const onlyFired = planRefires(schedule, misfires, rig, {
      usable: [pinAddress(1, 2)],
    });
    expect(onlyFired[0]!.spare).toBeUndefined();
    expect(onlyFired[0]!.reason).toBeDefined();
  });

  it("says so when nothing usable is left", () => {
    const misfires = misfiresIn(schedule, [pinAddress(1, 1)]);
    const plans = planRefires(schedule, misfires, rig, { usable: [] });
    expect(plans[0]!.spare).toBeUndefined();
    expect(plans[0]!.reason).toBeDefined();
  });

  it("still makes a shell safe rather than refiring it", () => {
    const misfires = misfiresIn(schedule, [pinAddress(1, 1), pinAddress(1, 3)]);
    const plans = planRefires(schedule, misfires, rig, {
      usable: [pinAddress(1, 6)],
    });
    const shell = plans.find(
      (plan) => formatPin(plan.misfire.address) === "01.03",
    );
    const gerb = plans.find(
      (plan) => formatPin(plan.misfire.address) === "01.01",
    );
    expect(shell!.spare).toBeUndefined();
    expect(shell!.reason).toBeDefined();
    expect(formatPin(gerb!.spare!)).toBe("01.06");
  });
});
