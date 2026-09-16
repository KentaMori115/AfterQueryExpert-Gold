import { describe, expect, it } from "vitest";
import {
  SourceFile,
  formatLocation,
  joinSpans,
  snippet,
  span,
  spanContains,
  spanLength,
} from "../../src/core/span.js";

const SCRIPT = [
  "show autumn",
  "  cue 12.4 shell6 from pad.a",
  "  cue 13.0 cake.silver from pad.b",
  "end",
].join("\n");

describe("span", () => {
  it("holds a start and an end", () => {
    const value = span(4, 9);
    expect(value.start).toBe(4);
    expect(value.end).toBe(9);
    expect(spanLength(value)).toBe(5);
  });

  it("allows a zero width span", () => {
    expect(spanLength(span(3, 3))).toBe(0);
  });

  it("refuses a backwards span", () => {
    expect(() => span(9, 4)).toThrow(/before it starts/);
  });

  it("refuses a negative start", () => {
    expect(() => span(-1, 4)).toThrow(/negative/);
  });

  it("refuses fractional offsets", () => {
    expect(() => span(1.5, 4)).toThrow(/integer/);
  });

  it("joins two spans into the range that covers both", () => {
    expect(joinSpans(span(10, 14), span(2, 5))).toEqual(span(2, 14));
  });

  it("tests containment with an exclusive end", () => {
    const value = span(4, 7);
    expect(spanContains(value, 4)).toBe(true);
    expect(spanContains(value, 6)).toBe(true);
    expect(spanContains(value, 7)).toBe(false);
    expect(spanContains(value, 3)).toBe(false);
  });
});

describe("SourceFile positions", () => {
  const file = new SourceFile("autumn.pf", SCRIPT);

  it("counts lines", () => {
    expect(file.lineCount).toBe(4);
  });

  it("puts offset zero on line one column one", () => {
    expect(file.positionAt(0)).toEqual({ offset: 0, line: 1, column: 1 });
  });

  it("finds a position on a later line", () => {
    const offset = SCRIPT.indexOf("cake.silver");
    const position = file.positionAt(offset);
    expect(position.line).toBe(3);
    expect(position.column).toBe(12);
  });

  it("puts the first character of a line on column one", () => {
    const offset = SCRIPT.indexOf("end");
    expect(file.positionAt(offset).column).toBe(1);
  });

  it("clamps past the end of the file", () => {
    const position = file.positionAt(SCRIPT.length + 500);
    expect(position.offset).toBe(SCRIPT.length);
    expect(position.line).toBe(4);
  });

  it("clamps a negative offset", () => {
    expect(file.positionAt(-20).offset).toBe(0);
  });

  it("round trips line and column back to an offset", () => {
    const offset = SCRIPT.indexOf("shell6");
    const position = file.positionAt(offset);
    expect(file.offsetAt(position.line, position.column)).toBe(offset);
  });

  it("clamps a column past the end of its line", () => {
    expect(file.offsetAt(1, 500)).toBe(SCRIPT.indexOf("\n"));
  });

  it("clamps a line past the end of the file", () => {
    expect(file.offsetAt(99, 1)).toBe(SCRIPT.lastIndexOf("end"));
  });
});

describe("SourceFile text", () => {
  const file = new SourceFile("autumn.pf", SCRIPT);

  it("returns a line without its terminator", () => {
    expect(file.lineText(1)).toBe("show autumn");
    expect(file.lineText(4)).toBe("end");
  });

  it("returns nothing for a line that is not there", () => {
    expect(file.lineText(40)).toBe("");
    expect(file.lineText(0)).toBe("");
  });

  it("slices a span", () => {
    const start = SCRIPT.indexOf("shell6");
    expect(file.slice(span(start, start + 6))).toBe("shell6");
  });

  it("handles carriage returns", () => {
    const crlf = new SourceFile("dos.pf", "show a\r\ncue 1\r\nend");
    expect(crlf.lineText(1)).toBe("show a");
    expect(crlf.lineText(2)).toBe("cue 1");
    expect(crlf.positionAt(crlf.text.indexOf("cue")).line).toBe(2);
  });

  it("handles an empty file", () => {
    const empty = new SourceFile("empty.pf", "");
    expect(empty.lineCount).toBe(1);
    expect(empty.lineText(1)).toBe("");
    expect(empty.positionAt(0)).toEqual({ offset: 0, line: 1, column: 1 });
  });
});

describe("snippet", () => {
  const file = new SourceFile("autumn.pf", SCRIPT);

  it("underlines the span on its own line", () => {
    const start = SCRIPT.indexOf("shell6");
    const rendered = snippet(file, span(start, start + 6));
    expect(rendered).toBe(
      ["2 |   cue 12.4 shell6 from pad.a", "  |            ^^^^^^"].join("\n"),
    );
  });

  it("stops a multi line span at the end of its first line", () => {
    const start = SCRIPT.indexOf("cue 12.4");
    const rendered = snippet(file, span(start, SCRIPT.indexOf("end")));
    const caretLine = rendered.split("\n")[1] ?? "";
    expect(caretLine.endsWith("^")).toBe(true);
    expect(caretLine).not.toContain("\n");
  });

  it("truncates a very long line", () => {
    const long = new SourceFile("long.pf", `cue ${"x".repeat(400)}`);
    const rendered = snippet(long, span(4, 10), { maxWidth: 20 });
    expect(rendered).toContain("...");
    expect(rendered.split("\n")[0]?.length).toBeLessThan(40);
  });

  it("marks a zero width span with one caret", () => {
    const rendered = snippet(file, span(0, 0));
    expect(rendered.split("\n")[1]).toBe("  | ^");
  });
});

describe("formatLocation", () => {
  it("names the file, line and column", () => {
    const file = new SourceFile("autumn.pf", SCRIPT);
    const start = SCRIPT.indexOf("cake.silver");
    expect(formatLocation(file, span(start, start + 4))).toBe("autumn.pf:3:12");
  });
});
