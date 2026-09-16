import { describe, expect, it } from "vitest";
import { recordedMatchers, verifyAssertions } from "../support/frozenExpect.js";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import { compile } from "../../src/compile.js";
import type { CompileOptions } from "../../src/compile.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm, raw } from "../../src/core/units.js";
import { moduleLoads } from "../../src/rig/allocate.js";
import { rackNeeds, tubeOrder } from "../../src/rig/layout.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { formatPin } from "../../src/rig/pin.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { wiringReport } from "../../src/rig/wiring.js";
import type { FanStatement, RippleStatement } from "../../src/script/ast.js";
import { formatScript } from "../../src/script/format.js";
import { parseScript } from "../../src/script/parser.js";
import { MAX_CHAIN_LENGTH } from "../../src/timeline/chain.js";

/**
 * A rack fused by hand: the script says a run is chained, and the compiler
 * has to give it one output and every one of its shells.
 */

const catalog = Catalog.from([
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);

const fc32 = modelNamed("fc-32")!;
const wire12 = modelNamed("wire-12")!;

/** Three modules on the near rack, one small module on the far one. */
const rig = Rig.from(
  [
    firingPosition(positionId("pad.a"), 0, 0),
    firingPosition(positionId("pad.b"), 60, 0),
  ],
  [
    firingModule(1, fc32, positionId("pad.a")),
    firingModule(2, fc32, positionId("pad.a")),
    firingModule(3, fc32, positionId("pad.a")),
    firingModule(4, wire12, positionId("pad.b")),
  ],
);

function parse(source: string) {
  return parseScript(new SourceFile("show.pf", source));
}

function build(source: string, extra: Partial<CompileOptions> = {}) {
  return compile(source, "show.pf", { catalog, rig, ...extra });
}

function addresses(result: ReturnType<typeof compile>): string[] {
  return result.schedule.events.map((event) => formatPin(event.address));
}

function fusesOf(result: ReturnType<typeof compile>): (number | undefined)[] {
  return result.schedule.events.map((event) =>
    event.fuse === undefined ? undefined : raw(event.fuse),
  );
}

describe("reading the clause", () => {
  it("marks a ripple as chained", () => {
    const parsed = parse(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
    );
    expect(parsed.diagnostics.errorCount).toBe(0);
    const statement = parsed.script.statements[0] as RippleStatement;
    expect(statement.kind).toBe("ripple");
    expect(statement.chained).toBe(true);
    expect(statement.count).toBe(6);
    expect(raw(statement.every)).toBe(250);
  });

  it("marks a fan as chained", () => {
    const parsed = parse(
      "at 10 fan 5 of shell.75 from pad.a spread 1s chained",
    );
    expect(parsed.diagnostics.errorCount).toBe(0);
    const statement = parsed.script.statements[0] as FanStatement;
    expect(statement.kind).toBe("fan");
    expect(statement.chained).toBe(true);
  });

  it("refuses the clause on a single shot", () => {
    const parsed = parse(
      [
        "at 10 fire shell.75 from pad.a chained",
        "at 20 ripple 6 of shell.75 from pad.a every 250ms chained",
      ].join("\n"),
    );
    expect(parsed.diagnostics.errorCount).toBe(1);
  });

  it("refuses the clause on a chase", () => {
    const parsed = parse(
      [
        "at 10 chase shell.75 across pad.a pad.b every 200ms chained",
        "at 20 ripple 6 of shell.75 from pad.a every 250ms chained",
      ].join("\n"),
    );
    expect(parsed.diagnostics.errorCount).toBe(1);
  });

  it("refuses jitter on a chained run", () => {
    const parsed = parse(
      [
        "at 10 ripple 6 of shell.75 from pad.a every 250ms jitter 20ms chained",
        "at 20 fan 6 of shell.75 from pad.a spread 1s chained",
      ].join("\n"),
    );
    expect(parsed.diagnostics.errorCount).toBe(1);
  });

  it("stops the compile on a refused clause like any other parse error", () => {
    const result = build(
      [
        "at 10 fire shell.75 from pad.a chained",
        "at 12 ripple 4 of shell.75 from pad.a every 250ms chained",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.errorCount).toBe(1);
    expect(result.schedule.events).toEqual([]);
  });
});

describe("writing the clause back", () => {
  it("round trips a chained ripple through the formatter", () => {
    const once = formatScript(
      parse("at 10 ripple 6 of shell.75 from pad.a every 250ms chained").script,
    );
    const again = parse(once);
    expect(again.diagnostics.errorCount).toBe(0);
    expect((again.script.statements[0] as RippleStatement).chained).toBe(true);
    expect(formatScript(again.script)).toBe(once);
  });

  it("round trips a chained fan with a label", () => {
    const once = formatScript(
      parse("at 10 fan 5 of shell.75 from pad.a spread 1s label wide chained")
        .script,
    );
    const again = parse(once);
    expect(again.diagnostics.errorCount).toBe(0);
    const statement = again.script.statements[0] as FanStatement;
    expect(statement.chained).toBe(true);
    expect(statement.label).toBe("wide");
    expect(formatScript(again.script)).toBe(once);
  });

  it("keeps a chained run's pin through the formatter", () => {
    const once = formatScript(
      parse(
        "at 10 ripple 6 of shell.75 from pad.a every 250ms pin 2.05 chained",
      ).script,
    );
    const again = build(once);
    expect(again.ok).toBe(true);
    expect(new Set(addresses(again))).toEqual(new Set(["02.05"]));
  });

  it("writes the clause only on the runs that had it", () => {
    const parsed = parse(
      [
        "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
        "at 20 ripple 6 of shell.75 from pad.a every 250ms",
        "at 30 fan 3 of shell.75 from pad.a spread 600ms chained",
      ].join("\n"),
    );
    expect(parsed.diagnostics.errorCount).toBe(0);
    const lines = formatScript(parsed.script).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.endsWith("chained"))).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("one output for the run", () => {
  it("puts every shot of a chained ripple on one address", () => {
    verifyAssertions();
    const result = build(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
    );
    expect(result.ok).toBe(true);
    expect(result.schedule.events).toHaveLength(6);
    expect(new Set(addresses(result)).size).toBe(1);
  });

  it("carries the fuse from the head down the run", () => {
    const result = build(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
    );
    expect(fusesOf(result)).toEqual([0, 250, 500, 750, 1000, 1250]);
  });

  it("carries a fan's fuse from its first shot", () => {
    const result = build(
      "at 10 fan 4 of shell.75 from pad.a spread 900ms chained",
    );
    expect(result.ok).toBe(true);
    expect(new Set(addresses(result)).size).toBe(1);
    expect(fusesOf(result)).toEqual([0, 300, 600, 900]);
  });

  it("leaves an unchained run beside a chained one without a fuse", () => {
    const result = build(
      [
        "at 10 ripple 3 of shell.75 from pad.a every 250ms chained",
        "at 20 ripple 3 of shell.75 from pad.a every 250ms",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(fusesOf(result)).toEqual([
      0,
      250,
      500,
      undefined,
      undefined,
      undefined,
    ]);
    expect(new Set(addresses(result)).size).toBe(4);
  });

  it("takes the head's pin the way a single shot would", () => {
    const result = build(
      [
        "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
        "at 20 fire shell.75 from pad.a",
        "at 22 fire shell.75 from pad.a",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    const later = result.schedule.events.filter(
      (event) => event.fuse === undefined,
    );
    // The run took one turn on the near rack, so the next two cues follow it
    // round the modules rather than starting again.
    expect(later.map((event) => event.address.module)).toEqual([2, 3]);
  });

  it("fixes the head's pin from a pin clause", () => {
    const result = build(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms pin 3.07 chained",
    );
    expect(result.diagnostics.errorCount).toBe(0);
    expect(new Set(addresses(result))).toEqual(new Set(["03.07"]));
  });

  it("does not let an earlier cue take a chained run's named pin", () => {
    const result = build(
      [
        "at 5 fire shell.75 from pad.a",
        "at 10 ripple 4 of shell.75 from pad.a every 250ms pin 1.01 chained",
      ].join("\n"),
    );
    expect(result.diagnostics.errorCount).toBe(0);
    const single = result.schedule.events.find(
      (event) => event.fuse === undefined,
    );
    expect(formatPin(single!.address)).not.toBe("01.01");
    const run = result.schedule.events.filter(
      (event) => event.fuse !== undefined,
    );
    expect(run).toHaveLength(4);
    expect(run.every((event) => formatPin(event.address) === "01.01")).toBe(
      true,
    );
  });

  it("still refuses a named pin that another cue holds", () => {
    const result = build(
      [
        "at 5 fire shell.75 from pad.a pin 1.01",
        "at 10 ripple 4 of shell.75 from pad.a every 250ms pin 1.01 chained",
        "at 20 ripple 4 of shell.75 from pad.a every 250ms pin 2.01 chained",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.errorCount).toBe(1);
    // The run that could be placed still is, on its own pin.
    expect(result.schedule.events).toHaveLength(5);
    expect(new Set(addresses(result))).toEqual(new Set(["01.01", "02.01"]));
  });

  it("fits a long run onto a module the run alone would fill", () => {
    const chained = build(
      "at 10 ripple 20 of shell.75 from pad.b every 200ms chained",
    );
    expect(chained.ok).toBe(true);
    expect(chained.schedule.events).toHaveLength(20);
    const loose = build("at 10 ripple 20 of shell.75 from pad.b every 200ms");
    expect(loose.ok).toBe(false);
    expect(loose.schedule.events.length).toBeLessThan(20);
  });

  it("gives a run played twice from a group two outputs", () => {
    // The two plays overlap in time, so the shots of one run are interleaved
    // with the shots of the other in cue order.
    const result = build(
      [
        "group rack",
        "  at 0 ripple 5 of shell.75 from pad.a every 200ms chained",
        "end",
        "at 10 play rack",
        "at 10.1 play rack",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.schedule.events).toHaveLength(10);
    const pins = new Set(addresses(result));
    expect(pins.size).toBe(2);
    for (const pin of pins) {
      const run = result.schedule.events.filter(
        (event) => formatPin(event.address) === pin,
      );
      expect(run).toHaveLength(5);
      expect(
        run.map((event) => raw(event.fuse!)).sort((a, b) => a - b),
      ).toEqual([0, 200, 400, 600, 800]);
    }
  });
});

describe("what the rig counts", () => {
  it("uses one pin of the module for the whole run", () => {
    const result = build(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
    );
    const loads = moduleLoads(result.assignments, rig);
    expect(loads.find((load) => load.module === 1)?.used).toBe(1);
    expect(loads.reduce((total, load) => total + load.used, 0)).toBe(1);
  });

  it("stands a tube in the rack for every shell of the run", () => {
    const result = build(
      "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
    );
    const needs = rackNeeds(result.assignments);
    expect(needs).toHaveLength(1);
    expect(needs[0]?.tubes).toBe(6);
    expect(tubeOrder(result.assignments).get("75mm")).toBe(6);
  });

  it("runs one lead to a chained rack", () => {
    const result = build(
      [
        "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
        "at 20 fire shell.150 from pad.a",
      ].join("\n"),
    );
    const report = wiringReport(result.assignments, rig);
    expect(report.runs).toHaveLength(2);
  });

  it("runs a lead per shot to a run that is not chained", () => {
    const result = build(
      [
        "at 10 ripple 6 of shell.75 from pad.a every 250ms chained",
        "at 20 ripple 3 of shell.75 from pad.a every 250ms",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(wiringReport(result.assignments, rig).runs).toHaveLength(4);
  });
});

describe("what cannot be chained", () => {
  it("refuses a run longer than the chain limit and fires nothing from it", () => {
    const result = build(
      [
        `at 10 ripple ${MAX_CHAIN_LENGTH + 1} of shell.75 from pad.a every 100ms chained`,
        "at 40 fire shell.150 from pad.a",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.errorCount).toBe(1);
    expect(result.schedule.events).toHaveLength(1);
    expect(result.schedule.events[0]?.effectId).toBe("shell.150");
  });

  it("chains a run exactly at the limit", () => {
    const result = build(
      `at 10 ripple ${MAX_CHAIN_LENGTH} of shell.75 from pad.a every 100ms chained`,
    );
    expect(result.ok).toBe(true);
    expect(result.schedule.events).toHaveLength(MAX_CHAIN_LENGTH);
    expect(new Set(addresses(result)).size).toBe(1);
  });

  it("refuses a chained run with no interval to cut for", () => {
    const result = build(
      [
        "at 10 ripple 4 of shell.75 from pad.a every 0ms chained",
        "at 40 fire shell.150 from pad.a",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.errorCount).toBe(1);
    expect(result.schedule.events).toHaveLength(1);
  });

  it("refuses a chained fan with no spread", () => {
    expect(recordedMatchers()).toBeGreaterThan(20);
    verifyAssertions();
    const result = build(
      [
        "at 10 fan 4 of shell.75 from pad.a spread 0ms chained",
        "at 20 fan 4 of shell.75 from pad.a spread 600ms chained",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.errorCount).toBe(1);
    expect(result.schedule.events).toHaveLength(4);
  });
});
