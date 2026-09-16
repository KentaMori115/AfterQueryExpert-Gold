import { describe, expect, it } from "vitest";
import {
  countTable,
  fixed,
  keyValueTable,
  indentLines,
  listPhrase,
  pad,
  plural,
  renderTable,
  truncate,
  wrap,
} from "../../src/core/text.js";

describe("pad", () => {
  it("pads left aligned to the right", () => {
    expect(pad("ab", 5, "left")).toBe("ab   ");
  });

  it("pads right aligned to the left", () => {
    expect(pad("ab", 5, "right")).toBe("   ab");
  });

  it("splits the difference when centred", () => {
    expect(pad("ab", 6, "center")).toBe("  ab  ");
    expect(pad("ab", 5, "center")).toBe(" ab  ");
  });

  it("leaves an over long value alone", () => {
    expect(pad("abcdef", 3, "left")).toBe("abcdef");
  });
});

describe("truncate", () => {
  it("leaves a short value alone", () => {
    expect(truncate("shell", 10)).toBe("shell");
  });

  it("cuts with an ellipsis", () => {
    expect(truncate("crackling palm", 10)).toBe("crackli...");
  });

  it("does not add an ellipsis when there is no room", () => {
    expect(truncate("crackling", 3)).toBe("cra");
    expect(truncate("crackling", 0)).toBe("");
  });
});

describe("renderTable", () => {
  const columns = [
    { header: "cue" },
    { header: "time", align: "right" as const },
    { header: "effect" },
  ];
  const rows = [
    ["1", "12.400", "shell.150.palm"],
    ["2", "8.0", "cake.silver"],
  ];

  it("sizes every column to its widest cell", () => {
    const lines = renderTable(columns, rows).split("\n");
    expect(lines[0]).toBe("cue    time  effect");
    expect(lines[2]).toBe("1    12.400  shell.150.palm");
  });

  it("right aligns the header of a right aligned column too", () => {
    const lines = renderTable(columns, rows).split("\n");
    expect(lines[0]).toContain("  time");
  });

  it("right aligns what it was told to", () => {
    const lines = renderTable(columns, rows).split("\n");
    expect(lines[3]).toBe("2       8.0  cake.silver");
  });

  it("draws a rule under the header", () => {
    const lines = renderTable(columns, rows).split("\n");
    expect(lines[1]).toBe("---  ------  --------------");
  });

  it("can leave the rule out", () => {
    const lines = renderTable(columns, rows, { rule: false }).split("\n");
    expect(lines).toHaveLength(3);
  });

  it("takes a custom separator and indent", () => {
    const lines = renderTable(columns, rows, {
      separator: " | ",
      indent: "  ",
    }).split("\n");
    expect(lines[0]).toBe("  cue |   time | effect");
  });

  it("fills a short row with empty cells", () => {
    const lines = renderTable(columns, [["1"]]).split("\n");
    expect(lines[2]).toBe("1");
  });

  it("truncates a column that asked for it", () => {
    const narrow = [{ header: "effect", maxWidth: 8 }];
    const lines = renderTable(narrow, [["shell.150.palm"]]).split("\n");
    expect(lines[2]).toBe("shell...");
  });

  it("strips trailing space from every line", () => {
    const rendered = renderTable(columns, rows);
    for (const line of rendered.split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("renders headers alone when there are no rows", () => {
    expect(renderTable(columns, []).split("\n")).toHaveLength(2);
  });
});

describe("wrap", () => {
  it("breaks on word boundaries", () => {
    expect(wrap("the quick brown fox jumps", 10)).toEqual([
      "the quick",
      "brown fox",
      "jumps",
    ]);
  });

  it("keeps an over long word on its own line", () => {
    expect(wrap("a supercalifragilistic word", 6)).toEqual([
      "a",
      "supercalifragilistic",
      "word",
    ]);
  });

  it("collapses runs of whitespace", () => {
    expect(wrap("one   two", 20)).toEqual(["one two"]);
  });

  it("returns one empty line for empty text", () => {
    expect(wrap("", 20)).toEqual([""]);
  });

  it("gives up on a nonsense width", () => {
    expect(wrap("some text", 0)).toEqual(["some text"]);
  });
});

describe("indentLines", () => {
  it("prefixes every non empty line", () => {
    expect(indentLines("a\n\nb", "  ")).toBe("  a\n\n  b");
  });
});

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "shell")).toBe("1 shell");
    expect(plural(2, "shell")).toBe("2 shells");
    expect(plural(0, "shell")).toBe("0 shells");
  });

  it("takes an irregular plural", () => {
    expect(plural(3, "match", "matches")).toBe("3 matches");
  });
});

describe("listPhrase", () => {
  it("joins with a final and", () => {
    expect(listPhrase(["a", "b", "c"])).toBe("a, b and c");
    expect(listPhrase(["a", "b"])).toBe("a and b");
    expect(listPhrase(["a"])).toBe("a");
    expect(listPhrase([])).toBe("");
  });
});

describe("fixed", () => {
  it("keeps the requested places", () => {
    expect(fixed(1.005, 2)).toBe("1.00");
    expect(fixed(12, 3)).toBe("12.000");
  });

  it("never prints negative zero", () => {
    expect(fixed(-0.0001, 2)).toBe("0.00");
  });
});

describe("keyValueTable", () => {
  it("uses what and value by default", () => {
    const table = keyValueTable([["effect", "6in palm"]]);
    expect(table.split("\n")[0]).toContain("what");
    expect(table.split("\n")[0]).toContain("value");
  });

  it("takes its own headers", () => {
    const table = keyValueTable([["a", "b"]], ["item", "detail"]);
    expect(table.split("\n")[0]).toContain("item");
    expect(table.split("\n")[0]).toContain("detail");
  });

  it("renders headers alone for no rows", () => {
    expect(keyValueTable([]).split("\n")).toHaveLength(2);
  });
});

describe("countTable", () => {
  it("right aligns the count", () => {
    const table = countTable([
      ["a", 1],
      ["bbbb", 1000],
    ]);
    const rows = table.split("\n").slice(2);
    expect(rows[0]?.endsWith("   1")).toBe(true);
    expect(rows[1]?.endsWith("1000")).toBe(true);
  });

  it("takes its own headers", () => {
    expect(countTable([["75mm", 4]], ["bore", "racks"])).toContain("racks");
  });

  it("renders headers alone for no entries", () => {
    expect(countTable([]).split("\n")).toHaveLength(2);
  });
});
