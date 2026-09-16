import { describe, expect, it } from "vitest";
import { calibre } from "../src/catalog/calibre.js";
import { parseCatalog } from "../src/catalog/parse.js";
import { shell } from "../src/catalog/effect.js";
import { Catalog } from "../src/catalog/registry.js";
import { parseMagazine } from "../src/catalog/magazine.js";
import { compile } from "../src/compile.js";
import { Rng } from "../src/core/rng.js";
import { effectId, positionId } from "../src/core/ids.js";
import { mm } from "../src/core/units.js";
import { parseContinuity } from "../src/rig/continuity.js";
import { firingModule, modelNamed } from "../src/rig/module.js";
import { parseRig } from "../src/rig/parse.js";
import { Rig, firingPosition } from "../src/rig/rig.js";
import {
  MAX_SCRIPT_BYTES,
  MAX_WORDS_PER_LINE,
  parseScript,
} from "../src/script/parser.js";
import { SourceFile } from "../src/core/span.js";

/**
 * Nothing in the loading layer may throw.
 *
 * Every one of these readers is handed a file somebody typed, and a throw
 * there means a stack trace on a laptop in a field instead of a diagnostic
 * that says which line. So the contract is that a reader always returns, with
 * whatever it managed and a bag of problems, however bad the input is.
 */

const catalog = Catalog.from([
  shell({ id: effectId("shell.150"), name: "six", calibre: calibre(mm(150)) }),
]);
const rig = Rig.from(
  [firingPosition(positionId("pad.a"), 0, 0)],
  [firingModule(1, modelNamed("fc-32")!, positionId("pad.a"))],
);

const NASTY = [
  "",
  " ",
  "\n",
  "\n\n\n",
  "\r\n\r\n",
  "\t\t",
  "#",
  "# only a comment",
  '"',
  '"unclosed',
  "at",
  "at 1",
  "at 1 fire",
  "at 1 fire a",
  "at 1 fire a from",
  "at 1 fire a from b pin",
  "at 1 fire a from b pin 1.",
  "at 1 ripple",
  "at 1 ripple of",
  "at 1 ripple -4 of a from b every 1",
  "at 1 ripple 1e9 of a from b every 1",
  "at 1 fan 3 of a from b spread",
  "at 1 chase",
  "at 1 chase a across",
  "at 1 chase a across b every",
  "at -1 fire a from b",
  "at 99:99:99 fire a from b",
  "group",
  "group a",
  "end",
  "end end end",
  "group a\ngroup b\ngroup c",
  "show",
  "seed",
  "frame",
  "frame -1",
  "include",
  "play",
  "at 1 play",
  "@@@@",
  "at 1 fire é from b",
  "a".repeat(5000),
  "at 1 fire a from b ".repeat(200),
  Array.from({ length: 500 }, (_, i) => `at ${i} fire a from b`).join("\n"),
];

describe("the script reader never throws", () => {
  for (const [index, source] of NASTY.entries()) {
    it(`survives input ${index}`, () => {
      expect(() =>
        parseScript(new SourceFile("nasty.pf", source)),
      ).not.toThrow();
    });
  }

  it("always reports something for input it cannot use", () => {
    const broken = ["at", "group", "@@@@", "at 1 fire a from"];
    for (const source of broken) {
      const parsed = parseScript(new SourceFile("n.pf", source));
      expect(parsed.diagnostics.size).toBeGreaterThan(0);
    }
  });

  it("never invents a statement it did not read", () => {
    for (const source of NASTY) {
      const parsed = parseScript(new SourceFile("n.pf", source));
      const lines = source.split("\n").filter((line) => line.trim().length > 0);
      expect(parsed.script.statements.length).toBeLessThanOrEqual(lines.length);
    }
  });
});

describe("the guards on a file that is not a script", () => {
  it("refuses a file far too large to be a show", () => {
    const huge = new SourceFile("huge.pf", "a".repeat(MAX_SCRIPT_BYTES + 1));
    const parsed = parseScript(huge);
    expect(parsed.diagnostics.byCode("PF2120")).toHaveLength(1);
    expect(parsed.script.statements).toEqual([]);
  });

  it("accepts a file just inside the limit", () => {
    const big = new SourceFile("big.pf", "# ".repeat(1000));
    expect(parseScript(big).diagnostics.byCode("PF2120")).toEqual([]);
  });

  it("refuses a line far too long to be a cue", () => {
    const line = `at 1 fire a from b ${"label x ".repeat(MAX_WORDS_PER_LINE)}`;
    const parsed = parseScript(new SourceFile("long.pf", line));
    expect(parsed.diagnostics.byCode("PF2121")).toHaveLength(1);
  });

  it("keeps reading the lines after a line that is too long", () => {
    const line = `at 1 fire a from b ${"label x ".repeat(MAX_WORDS_PER_LINE)}`;
    const parsed = parseScript(
      new SourceFile("long.pf", [line, "at 2 fire a from b"].join("\n")),
    );
    expect(parsed.script.statements).toHaveLength(1);
  });
});

describe("the whole compiler never throws", () => {
  for (const [index, source] of NASTY.entries()) {
    it(`compiles input ${index} without falling over`, () => {
      expect(() => compile(source, "nasty.pf", { catalog, rig })).not.toThrow();
    });
  }

  it("gives an empty schedule rather than a broken one", () => {
    for (const source of NASTY) {
      const result = compile(source, "nasty.pf", { catalog, rig });
      for (const event of result.schedule.events) {
        expect(Number.isFinite(event.ignitionAt)).toBe(true);
        expect(event.address.pin).toBeGreaterThan(0);
      }
    }
  });
});

describe("the file readers never throw", () => {
  const files = [
    "",
    ",",
    ",,,\n,,,",
    '"',
    '"a,b',
    " ",
    "a".repeat(3000),
    `id,kind,name\n${",,\n".repeat(50)}`,
    `lot,effect,quantity\n${",,\n".repeat(50)}`,
    `pin,state\n${",\n".repeat(50)}`,
  ];

  for (const [index, text] of files.entries()) {
    it(`reads catalog ${index}`, () => {
      expect(() => parseCatalog(text, "c.csv")).not.toThrow();
    });

    it(`reads magazine ${index}`, () => {
      expect(() => parseMagazine(text, "m.csv")).not.toThrow();
    });

    it(`reads continuity ${index}`, () => {
      expect(() => parseContinuity(text, "w.csv")).not.toThrow();
    });

    it(`reads rig ${index}`, () => {
      expect(() => parseRig(text, "r.rig")).not.toThrow();
    });
  }
});

describe("random scripts", () => {
  const words = [
    "at",
    "fire",
    "from",
    "ripple",
    "of",
    "every",
    "group",
    "end",
    "play",
    "1",
    "12.4",
    "250ms",
    "shell.150",
    "pad.a",
    "-",
    '"',
    "#",
  ];

  it("survives a thousand random word salads", () => {
    const rng = new Rng("fuzz");
    for (let i = 0; i < 1000; i += 1) {
      const lines: string[] = [];
      for (let line = 0; line < rng.nextInt(1, 6); line += 1) {
        const parts: string[] = [];
        for (let word = 0; word < rng.nextInt(1, 8); word += 1) {
          parts.push(rng.pick(words));
        }
        lines.push(parts.join(" "));
      }
      const source = lines.join("\n");
      expect(() => compile(source, "fuzz.pf", { catalog, rig })).not.toThrow();
    }
  });

  it("never produces a schedule with a duplicate pin", () => {
    const rng = new Rng("fuzz-pins");
    for (let i = 0; i < 200; i += 1) {
      const count = rng.nextInt(1, 40);
      const source = `at 10 ripple ${count} of shell.150 from pad.a every ${rng.nextInt(1, 500)}ms`;
      const result = compile(source, "fuzz.pf", { catalog, rig });
      const pins = new Set(
        result.schedule.events.map(
          (event) => `${event.address.module}:${event.address.pin}`,
        ),
      );
      expect(pins.size).toBe(result.schedule.events.length);
    }
  });
});
