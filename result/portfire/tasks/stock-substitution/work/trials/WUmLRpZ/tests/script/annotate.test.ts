import { describe, expect, it } from "vitest";
import { calibre } from "../../src/catalog/calibre.js";
import { shell } from "../../src/catalog/effect.js";
import { Catalog } from "../../src/catalog/registry.js";
import {
  annotatableStatements,
  annotateScript,
  annotatedLines,
  isAnnotated,
  stripAnnotations,
} from "../../src/script/annotate.js";
import { allocatePins } from "../../src/rig/allocate.js";
import { firingModule, modelNamed } from "../../src/rig/module.js";
import { Rig, firingPosition } from "../../src/rig/rig.js";
import { expandScript } from "../../src/script/expand.js";
import { parseScript } from "../../src/script/parser.js";
import { resolveShots } from "../../src/script/resolve.js";
import { buildSchedule } from "../../src/timeline/schedule.js";
import { effectId, positionId } from "../../src/core/ids.js";
import { SourceFile } from "../../src/core/span.js";
import { mm } from "../../src/core/units.js";

const catalog = Catalog.from([
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
  shell({ id: effectId("shell.75"), name: "three", calibre: calibre(mm(75)) }),
]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [firingModule(1, modelNamed("slat-50")!, positionId("pad.a"))],
);

const SOURCE = [
  "show autumn",
  "",
  "at 20 fire shell.150 from pad.a",
  "at 24 ripple 3 of shell.75 from pad.a every 300ms",
  "",
].join("\n");

function annotate(source = SOURCE, options = {}) {
  const file = new SourceFile("show.pf", source);
  const parsed = parseScript(file);
  expect(parsed.diagnostics.errorCount).toBe(0);
  const expanded = expandScript(parsed.script.statements, { seed: "t" });
  const resolved = resolveShots(expanded.shots, catalog, rig);
  const allocated = allocatePins(resolved.shots, rig, { packTight: true });
  const schedule = buildSchedule(allocated.assignments);
  return {
    text: annotateScript(source, parsed.script, schedule, file, options),
    script: parsed.script,
    schedule,
    file,
  };
}

describe("annotateScript", () => {
  it("puts the firing time on each cue line", () => {
    const lines = annotate().text.split("\n");
    expect(lines[2]).toContain("#> fires 0:15.970");
  });

  it("puts the pins on the line too", () => {
    expect(annotate().text).toContain("01.01");
  });

  it("leaves blank lines and headers alone", () => {
    const lines = annotate().text.split("\n");
    expect(lines[0]).toBe("show autumn");
    expect(lines[1]).toBe("");
  });

  it("summarises a long run rather than listing every pin", () => {
    const long = [
      "show autumn",
      "at 20 ripple 12 of shell.75 from pad.a every 300ms",
    ].join("\n");
    const text = annotate(long).text;
    expect(text).toContain("12 pins");
    expect(text).toContain(" to ");
  });

  it("takes its own run length before summarising", () => {
    const text = annotate(SOURCE, { maxPins: 1 }).text;
    expect(text).toContain("3 pins");
  });

  it("can leave the pins out", () => {
    const text = annotate(SOURCE, { pins: false }).text;
    expect(text).toContain("fires");
    expect(text).not.toContain("01.01");
  });

  it("is stable, so annotating twice gives the same text", () => {
    const once = annotate().text;
    const twice = annotate(once).text;
    expect(twice).toBe(once);
  });

  it("annotates a group body where it is written", () => {
    const grouped = [
      "show autumn",
      "group finale",
      "  at 0 fire shell.150 from pad.a",
      "end",
      "at 60 play finale",
    ].join("\n");
    const lines = annotate(grouped).text.split("\n");
    expect(lines[2]).toContain("#> fires");
    expect(lines[4]).not.toContain("#>");
  });

  it("leaves a script with no cues untouched", () => {
    expect(annotate("show quiet\n").text).toBe("show quiet\n");
  });
});

describe("stripAnnotations", () => {
  it("takes the comments back off", () => {
    const annotated = annotate().text;
    expect(stripAnnotations(annotated)).toBe(SOURCE);
  });

  it("leaves an ordinary comment alone", () => {
    const source = "at 20 fire shell.150 from pad.a # the big one\n";
    expect(stripAnnotations(source)).toBe(source);
  });

  it("does nothing to a source with no annotations", () => {
    expect(stripAnnotations(SOURCE)).toBe(SOURCE);
  });
});

describe("isAnnotated", () => {
  it("recognises an annotated script", () => {
    expect(isAnnotated(annotate().text)).toBe(true);
    expect(isAnnotated(SOURCE)).toBe(false);
  });
});

describe("counting", () => {
  it("says how many lines carry an answer", () => {
    const { script, schedule, file } = annotate();
    expect(annotatedLines(script, schedule, file)).toBe(2);
  });

  it("lists the statements that could carry one", () => {
    const { script } = annotate();
    expect(annotatableStatements(script)).toHaveLength(2);
  });
});
