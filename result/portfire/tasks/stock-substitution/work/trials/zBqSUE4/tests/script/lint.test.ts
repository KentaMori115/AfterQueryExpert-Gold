import { describe, expect, it } from "vitest";
import { lintClean, lintScript } from "../../src/script/lint.js";
import { parseScript } from "../../src/script/parser.js";
import { SourceFile } from "../../src/core/span.js";

function lint(source: string, options = {}) {
  const parsed = parseScript(new SourceFile("show.pf", source));
  expect(parsed.diagnostics.errorCount).toBe(0);
  return lintScript(parsed.script, options);
}

function codes(source: string, options = {}): string[] {
  return lint(source, options)
    .all()
    .map((diagnostic) => diagnostic.code);
}

const CLEAN = [
  "show autumn",
  "at 10 fire shell.150 from pad.a",
  "at 12 ripple 4 of shell.75 from pad.b every 200ms",
].join("\n");

describe("a clean script", () => {
  it("raises nothing", () => {
    expect(codes(CLEAN)).toEqual([]);
    const parsed = parseScript(new SourceFile("show.pf", CLEAN));
    expect(lintClean(parsed.script)).toBe(true);
  });
});

describe("groups", () => {
  it("warns about a group nothing plays", () => {
    expect(
      codes(["show a", "group finale", "at 0 fire x from y", "end"].join("\n")),
    ).toContain("PF2600");
  });

  it("says nothing about a group that is played", () => {
    expect(
      codes(
        [
          "show a",
          "group finale",
          "at 0 fire x from y",
          "end",
          "at 60 play finale",
        ].join("\n"),
      ),
    ).not.toContain("PF2600");
  });

  it("warns about an empty group", () => {
    const source = ["show a", "group finale", "end", "at 60 play finale"].join(
      "\n",
    );
    expect(codes(source)).toContain("PF2601");
  });

  it("counts a play from inside another group", () => {
    const source = [
      "show a",
      "group inner",
      "at 0 fire x from y",
      "end",
      "group outer",
      "at 0 play inner",
      "end",
      "at 10 play outer",
    ].join("\n");
    expect(codes(source)).not.toContain("PF2600");
  });
});

describe("intervals", () => {
  it("warns about a ripple tighter than a frame or two", () => {
    expect(
      codes(["show a", "at 10 ripple 8 of x from y every 40ms"].join("\n")),
    ).toContain("PF2602");
  });

  it("warns about a chase just as tightly", () => {
    expect(
      codes(["show a", "at 10 chase x across a b every 30ms"].join("\n")),
    ).toContain("PF2602");
  });

  it("takes its own threshold", () => {
    const source = ["show a", "at 10 ripple 8 of x from y every 100ms"].join(
      "\n",
    );
    expect(codes(source)).not.toContain("PF2602");
    expect(codes(source, { tightIntervalMs: 200 })).toContain("PF2602");
  });

  it("warns about a fan with no spread", () => {
    expect(
      codes(["show a", "at 10 fan 6 of x from y spread 0"].join("\n")),
    ).toContain("PF2603");
  });

  it("notes a very long run", () => {
    expect(
      codes(["show a", "at 10 ripple 80 of x from y every 200ms"].join("\n")),
    ).toContain("PF2604");
  });
});

describe("collisions", () => {
  it("warns about two cues from one position on one instant", () => {
    expect(
      codes(
        [
          "show a",
          "at 10 fire shell.150 from pad.a",
          "at 10 fire shell.75 from pad.a",
        ].join("\n"),
      ),
    ).toContain("PF2605");
  });

  it("says nothing when the positions differ", () => {
    expect(
      codes(
        [
          "show a",
          "at 10 fire shell.150 from pad.a",
          "at 10 fire shell.75 from pad.b",
        ].join("\n"),
      ),
    ).not.toContain("PF2605");
  });

  it("says nothing when the times differ", () => {
    expect(
      codes(
        [
          "show a",
          "at 10 fire shell.150 from pad.a",
          "at 10.1 fire shell.75 from pad.a",
        ].join("\n"),
      ),
    ).not.toContain("PF2605");
  });

  it("reports a third cue on the same instant only once more", () => {
    const found = codes(
      [
        "show a",
        "at 10 fire a from pad.a",
        "at 10 fire b from pad.a",
        "at 10 fire c from pad.a",
      ].join("\n"),
    ).filter((code) => code === "PF2605");
    expect(found).toHaveLength(2);
  });
});

describe("quiet stretches", () => {
  it("notes a long gap in the script", () => {
    expect(
      codes(
        ["show a", "at 10 fire x from y", "at 60 fire x from y"].join("\n"),
      ),
    ).toContain("PF2606");
  });

  it("takes its own threshold", () => {
    const source = [
      "show a",
      "at 10 fire x from y",
      "at 25 fire x from y",
    ].join("\n");
    expect(codes(source)).not.toContain("PF2606");
    expect(codes(source, { quietSeconds: 5 })).toContain("PF2606");
  });

  it("does not care what order the cues were written in", () => {
    expect(
      codes(
        ["show a", "at 60 fire x from y", "at 10 fire x from y"].join("\n"),
      ),
    ).toContain("PF2606");
  });
});

describe("headers", () => {
  it("warns about a script with no show name", () => {
    expect(codes("at 10 fire x from y")).toContain("PF2607");
  });

  it("warns about two seeds or two frame rates", () => {
    expect(
      codes(
        ["show a", "seed one", "seed two", "at 1 fire x from y"].join("\n"),
      ),
    ).toContain("PF2608");
    expect(
      codes(
        ["show a", "frame 25", "frame 30", "at 1 fire x from y"].join("\n"),
      ),
    ).toContain("PF2609");
  });

  it("says nothing about one of each", () => {
    expect(
      codes(
        ["show a", "seed one", "frame 25", "at 1 fire x from y"].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("lintClean", () => {
  it("is false when anything was raised", () => {
    const parsed = parseScript(new SourceFile("s.pf", "at 1 fire x from y"));
    expect(lintClean(parsed.script)).toBe(false);
  });

  it("ignores notes, which are not warnings", () => {
    const parsed = parseScript(
      new SourceFile(
        "s.pf",
        ["show a", "at 10 fire x from y", "at 60 fire x from y"].join("\n"),
      ),
    );
    expect(lintClean(parsed.script)).toBe(true);
  });
});
