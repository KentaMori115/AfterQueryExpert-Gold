import { describe, expect, it } from "vitest";
import { formatCue, formatScript } from "../../src/script/format.js";
import { parseScript } from "../../src/script/parser.js";
import type { CueStatement } from "../../src/script/ast.js";
import { SourceFile } from "../../src/core/span.js";

function format(source: string, options = {}): string {
  const parsed = parseScript(new SourceFile("show.pf", source));
  expect(parsed.diagnostics.errorCount).toBe(0);
  return formatScript(parsed.script, options);
}

function cue(source: string, options = {}): string {
  const parsed = parseScript(new SourceFile("show.pf", source));
  expect(parsed.diagnostics.errorCount).toBe(0);
  return formatCue(parsed.script.statements[0] as CueStatement, options);
}

describe("cue lines", () => {
  it("writes a plain fire", () => {
    expect(cue("at 12.4 fire shell.150 from pad.a")).toBe(
      "at 12.4 fire shell.150 from pad.a",
    );
  });

  it("writes a whole second with one decimal place", () => {
    expect(cue("at 12 fire a from b")).toBe("at 12.0 fire a from b");
  });

  it("writes a minute form time when asked", () => {
    expect(cue("at 1:23.450 fire a from b", { minuteTimes: true })).toBe(
      "at 1:23.450 fire a from b",
    );
  });

  it("writes a minute form time as seconds by default", () => {
    expect(cue("at 1:23.450 fire a from b")).toBe("at 83.45 fire a from b");
  });

  it("writes the clauses in a fixed order", () => {
    expect(cue("at 1 fire a from b label opener height 90 pin 3.01")).toBe(
      "at 1.0 fire a from b pin 03.01 height 90 label opener",
    );
  });

  it("quotes a label that needs it", () => {
    expect(cue('at 1 fire a from b label "the big one"')).toContain(
      'label "the big one"',
    );
  });

  it("writes a ripple with a whole second gap in seconds", () => {
    expect(cue("at 20 ripple 8 of a from b every 1000ms")).toBe(
      "at 20.0 ripple 8 of a from b every 1s",
    );
  });

  it("writes a sub second gap in milliseconds", () => {
    expect(cue("at 20 ripple 8 of a from b every 0.12")).toBe(
      "at 20.0 ripple 8 of a from b every 120ms",
    );
  });

  it("writes a fan with its spread and jitter", () => {
    expect(cue("at 40 fan 12 of a from b spread 800ms jitter 20ms")).toBe(
      "at 40.0 fan 12 of a from b spread 800ms jitter 20ms",
    );
  });

  it("writes a chase and only names passes when it is not one", () => {
    expect(cue("at 30 chase a across p q r every 200ms")).toBe(
      "at 30.0 chase a across p q r every 200ms",
    );
    expect(cue("at 30 chase a across p q every 200ms passes 3")).toContain(
      "passes 3",
    );
  });

  it("writes a play", () => {
    expect(cue("at 1:20 play finale")).toBe("at 80.0 play finale");
  });
});

describe("headers and groups", () => {
  it("writes each header on its own line", () => {
    const text = format(
      ["show autumn", "seed autumn-2025", "frame 30 drop"].join("\n"),
    );
    expect(text).toBe("show autumn\nseed autumn-2025\nframe 30 drop\n");
  });

  it("writes an include with quotes", () => {
    expect(format('include "cues/finale.pf"')).toBe(
      'include "cues/finale.pf"\n',
    );
  });

  it("indents a group body", () => {
    const text = format(
      ["group finale", "at 0 fire a from b", "end"].join("\n"),
    );
    expect(text).toBe("group finale\n  at 0.0 fire a from b\nend\n");
  });

  it("takes another indent width", () => {
    const text = format(
      ["group finale", "at 0 fire a from b", "end"].join("\n"),
      { indent: 4 },
    );
    expect(text).toContain("\n    at 0.0");
  });

  it("puts a blank line between the headers and the cues", () => {
    const text = format(["show autumn", "at 10 fire a from b"].join("\n"));
    expect(text).toBe("show autumn\n\nat 10.0 fire a from b\n");
  });

  it("puts a blank line round a group", () => {
    const text = format(
      [
        "show a",
        "group finale",
        "at 0 fire x from y",
        "end",
        "at 60 play finale",
      ].join("\n"),
    );
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("writes nothing for an empty script", () => {
    expect(format("")).toBe("");
  });
});

describe("round trips", () => {
  const SOURCES = [
    "show autumn\n\nat 10.0 fire shell.150 from pad.a\n",
    "at 20.0 ripple 8 of shell.75 from pad.a every 120ms jitter 20ms\n",
    "at 40.0 fan 12 of comet.50 from pad.b spread 800ms\n",
    "at 30.0 chase mine.100 across pad.a pad.b every 200ms passes 3\n",
    "group finale\n  at 0.0 fire a from b pin 12.04\nend\n",
  ];

  it("is stable, so formatting twice changes nothing", () => {
    for (const source of SOURCES) {
      expect(format(source)).toBe(source);
    }
  });

  it("survives a parse after formatting", () => {
    for (const source of SOURCES) {
      const parsed = parseScript(new SourceFile("s.pf", format(source)));
      expect(parsed.diagnostics.errorCount).toBe(0);
    }
  });

  it("collapses two spellings of the same show onto one text", () => {
    const one = format("at 1:23.450 fire a from b");
    const two = format("at 83.45 fire a from b");
    expect(one).toBe(two);
  });
});
