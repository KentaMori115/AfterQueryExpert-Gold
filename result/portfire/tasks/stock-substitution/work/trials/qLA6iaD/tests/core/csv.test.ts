import { describe, expect, it } from "vitest";
import {
  parseCsv,
  quoteField,
  readTable,
  tableToCsv,
  writeCsv,
} from "../../src/core/csv.js";

describe("parseCsv", () => {
  it("splits plain rows", () => {
    const rows = parseCsv("a,b,c\n1,2,3");
    expect(rows.map((row) => row.fields)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps the line number of each row", () => {
    const rows = parseCsv("a\nb\nc");
    expect(rows.map((row) => row.line)).toEqual([1, 2, 3]);
  });

  it("trims stray whitespace by default", () => {
    expect(parseCsv(" a , b ")[0]?.fields).toEqual(["a", "b"]);
  });

  it("can be told to keep whitespace", () => {
    expect(parseCsv(" a , b ", { trimFields: false })[0]?.fields).toEqual([
      " a ",
      " b ",
    ]);
  });

  it("reads a quoted field with the delimiter inside", () => {
    expect(parseCsv('a,"b,c",d')[0]?.fields).toEqual(["a", "b,c", "d"]);
  });

  it("reads a doubled quote as one quote", () => {
    expect(parseCsv('"say ""go"" now"')[0]?.fields).toEqual(['say "go" now']);
  });

  it("keeps whitespace inside a quoted field", () => {
    expect(parseCsv('" padded "')[0]?.fields).toEqual([" padded "]);
  });

  it("reads a newline inside a quoted field", () => {
    const rows = parseCsv('a,"line one\nline two",c');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fields[1]).toBe("line one\nline two");
  });

  it("swallows carriage returns", () => {
    expect(parseCsv("a,b\r\n1,2").map((row) => row.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("skips blank lines by default", () => {
    const rows = parseCsv("a\n\n\nb");
    expect(rows.map((row) => row.fields)).toEqual([["a"], ["b"]]);
  });

  it("numbers rows past a skipped blank correctly", () => {
    expect(parseCsv("a\n\nb").map((row) => row.line)).toEqual([1, 3]);
  });

  it("can be told to keep blank lines", () => {
    expect(parseCsv("a\n\nb", { skipBlank: false })).toHaveLength(3);
  });

  it("keeps a row of empty fields", () => {
    expect(parseCsv("a,,c")[0]?.fields).toEqual(["a", "", "c"]);
  });

  it("handles a trailing newline", () => {
    expect(parseCsv("a,b\n")).toHaveLength(1);
  });

  it("handles an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("takes another delimiter", () => {
    expect(parseCsv("a;b", { delimiter: ";" })[0]?.fields).toEqual(["a", "b"]);
  });

  it("refuses a delimiter that is not one character", () => {
    expect(() => parseCsv("a", { delimiter: "::" })).toThrow(/single/);
  });
});

describe("writeCsv", () => {
  it("writes plain fields bare", () => {
    expect(writeCsv([["a", "b"]])).toBe("a,b");
  });

  it("quotes a field holding the delimiter", () => {
    expect(writeCsv([["a,b", "c"]])).toBe('"a,b",c');
  });

  it("doubles an embedded quote", () => {
    expect(writeCsv([['say "go"']])).toBe('"say ""go"""');
  });

  it("quotes a field with a newline or padding", () => {
    expect(quoteField("one\ntwo")).toBe('"one\ntwo"');
    expect(quoteField(" padded ")).toBe('" padded "');
  });

  it("round trips through the parser", () => {
    const rows = [
      ["cue", "time", "note"],
      ["1", "12.400", 'six inch, "big" one'],
      ["2", "13.0", "line one\nline two"],
    ];
    const parsed = parseCsv(writeCsv(rows), { trimFields: false });
    expect(parsed.map((row) => row.fields)).toEqual(rows);
  });
});

describe("readTable", () => {
  const text = [
    "Cue Time,Effect,Position",
    "12.4,shell.150.palm,pad.a",
    "13.0,cake.silver,pad.b",
  ].join("\n");

  it("normalises headers", () => {
    expect(readTable(text).headers).toEqual(["cue_time", "effect", "position"]);
  });

  it("maps every record by header", () => {
    const table = readTable(text);
    expect(table.records[0]?.values.get("effect")).toBe("shell.150.palm");
    expect(table.records[1]?.values.get("cue_time")).toBe("13.0");
  });

  it("keeps the source line of each record", () => {
    expect(readTable(text).records.map((record) => record.line)).toEqual([
      2, 3,
    ]);
  });

  it("fills a short row with empty strings", () => {
    const short = readTable("a,b,c\n1");
    expect(short.records[0]?.values.get("c")).toBe("");
  });

  it("returns nothing for an empty file", () => {
    expect(readTable("")).toEqual({ headers: [], records: [] });
  });

  it("round trips through tableToCsv", () => {
    const table = readTable(text);
    const written = tableToCsv(
      table.headers,
      table.records.map((record) => record.values),
    );
    expect(readTable(written).records[0]?.values.get("position")).toBe("pad.a");
  });
});
