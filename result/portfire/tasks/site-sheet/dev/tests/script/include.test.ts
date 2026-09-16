import { describe, expect, it } from "vitest";
import {
  checkDuplicateGroups,
  duplicateGroups,
  includedFiles,
  loadScript,
  resolveInclude,
} from "../../src/script/include.js";
import { parseScript } from "../../src/script/parser.js";
import { SourceFile } from "../../src/core/span.js";

function readerFor(files: Record<string, string>) {
  return (path: string): string | undefined => files[path];
}

describe("resolveInclude", () => {
  it("resolves against the including file's folder", () => {
    expect(resolveInclude("shows/autumn.pf", "finale.pf")).toBe(
      "shows/finale.pf",
    );
  });

  it("walks up with a double dot", () => {
    expect(resolveInclude("shows/autumn.pf", "../lib/ripples.pf")).toBe(
      "lib/ripples.pf",
    );
  });

  it("ignores a single dot", () => {
    expect(resolveInclude("shows/autumn.pf", "./finale.pf")).toBe(
      "shows/finale.pf",
    );
  });

  it("keeps an absolute path as it is", () => {
    expect(resolveInclude("shows/autumn.pf", "/etc/lib.pf")).toBe(
      "/etc/lib.pf",
    );
  });

  it("resolves from a file at the top level", () => {
    expect(resolveInclude("autumn.pf", "finale.pf")).toBe("finale.pf");
  });
});

describe("loadScript", () => {
  const files = {
    "autumn.pf": [
      "show autumn",
      'include "cues/finale.pf"',
      "at 10 fire shell.150 from pad.a",
    ].join("\n"),
    "cues/finale.pf": [
      "group finale",
      "  at 0 fire shell.300 from pad.a",
      "end",
    ].join("\n"),
  };

  it("pulls the statements of both files together", () => {
    const loaded = loadScript("autumn.pf", readerFor(files));
    expect(loaded.diagnostics.size).toBe(0);
    expect(loaded.script.statements.map((s) => s.kind)).toEqual([
      "show",
      "group",
      "fire",
    ]);
  });

  it("lists every file it read", () => {
    expect(includedFiles("autumn.pf", readerFor(files))).toEqual([
      "autumn.pf",
      "cues/finale.pf",
    ]);
  });

  it("drops the include statement itself", () => {
    const loaded = loadScript("autumn.pf", readerFor(files));
    expect(loaded.script.statements.some((s) => s.kind === "include")).toBe(
      false,
    );
  });

  it("names the entry file as the source", () => {
    expect(loadScript("autumn.pf", readerFor(files)).script.source).toBe(
      "autumn.pf",
    );
  });

  it("reports a file it cannot read and says who asked for it", () => {
    const loaded = loadScript(
      "autumn.pf",
      readerFor({ "autumn.pf": 'include "gone.pf"' }),
    );
    const diagnostic = loaded.diagnostics.byCode("PF2500")[0];
    expect(diagnostic?.message).toContain("gone.pf");
    expect(diagnostic?.help).toContain("autumn.pf");
  });

  it("reports a missing entry file with no help line", () => {
    const loaded = loadScript("gone.pf", readerFor({}));
    expect(loaded.diagnostics.byCode("PF2500")).toHaveLength(1);
    expect("help" in (loaded.diagnostics.byCode("PF2500")[0] ?? {})).toBe(
      false,
    );
  });

  it("reads a file included twice only once", () => {
    const loaded = loadScript(
      "a.pf",
      readerFor({
        "a.pf": ['include "lib.pf"', 'include "lib.pf"'].join("\n"),
        "lib.pf": "group g\n  at 0 fire x from y\nend",
      }),
    );
    expect(loaded.files).toEqual(["a.pf", "lib.pf"]);
    expect(loaded.script.statements).toHaveLength(1);
  });

  it("reports a loop with the whole path round it", () => {
    const loaded = loadScript(
      "a.pf",
      readerFor({
        "a.pf": 'include "b.pf"',
        "b.pf": 'include "a.pf"',
      }),
    );
    const diagnostic = loaded.diagnostics.byCode("PF2501")[0];
    expect(diagnostic?.message).toContain("a.pf -> b.pf -> a.pf");
    expect(diagnostic?.help).toContain("cut one");
  });

  it("does not hang on a loop", () => {
    const loaded = loadScript(
      "a.pf",
      readerFor({
        "a.pf": 'include "b.pf"',
        "b.pf": 'include "c.pf"',
        "c.pf": 'include "a.pf"',
      }),
    );
    expect(loaded.files).toHaveLength(3);
  });

  it("passes a parse error in an included file through", () => {
    const loaded = loadScript(
      "a.pf",
      readerFor({ "a.pf": 'include "b.pf"', "b.pf": "rocket 4" }),
    );
    expect(loaded.diagnostics.byCode("PF2116")).toHaveLength(1);
  });
});

describe("duplicateGroups", () => {
  function scriptOf(source: string) {
    return parseScript(new SourceFile("s.pf", source)).script;
  }

  it("finds two groups with the same name", () => {
    const script = scriptOf(
      [
        "group finale",
        "  at 0 fire a from b",
        "end",
        "group finale",
        "  at 0 fire c from d",
        "end",
      ].join("\n"),
    );
    expect(duplicateGroups(script)).toEqual(["finale"]);
    expect(checkDuplicateGroups(script).byCode("PF2502")).toHaveLength(1);
  });

  it("finds none when the names differ", () => {
    const script = scriptOf(
      [
        "group a",
        "at 0 fire x from y",
        "end",
        "group b",
        "at 0 fire x from y",
        "end",
      ].join("\n"),
    );
    expect(duplicateGroups(script)).toEqual([]);
    expect(checkDuplicateGroups(script).size).toBe(0);
  });
});
