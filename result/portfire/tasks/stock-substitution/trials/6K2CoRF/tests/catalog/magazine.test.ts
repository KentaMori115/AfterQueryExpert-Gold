import { describe, expect, it } from "vitest";
import { parseMagazine, writeMagazine } from "../../src/catalog/magazine.js";

const HEADER = "lot,effect,quantity,received,note";
const rows = (...lines: string[]): string => [HEADER, ...lines].join("\n");

describe("headers", () => {
  it("refuses a file with nothing in it", () => {
    expect(
      parseMagazine("", "book.csv").diagnostics.byCode("PF1300"),
    ).toHaveLength(1);
  });

  it("names a missing required column", () => {
    const parsed = parseMagazine("lot,effect\nvn1,shell.150", "book.csv");
    expect(parsed.diagnostics.byCode("PF1301")).toHaveLength(1);
    expect(parsed.magazine.lotCount).toBe(0);
  });
});

describe("rows", () => {
  it("reads a lot", () => {
    const parsed = parseMagazine(
      rows("VN2405,shell.150.palm,20,2025-04-02,from the april container"),
      "book.csv",
    );
    expect(parsed.diagnostics.size).toBe(0);
    expect(parsed.magazine.onHand("shell.150.palm")).toBe(20);
    const lot = parsed.magazine.lotsFor("shell.150.palm")[0];
    expect(lot?.lotNumber).toBe("vn2405");
    expect(lot?.received).toBe("2025-04-02");
    expect(lot?.note).toContain("april");
  });

  it("adds two rows of the same lot together", () => {
    const parsed = parseMagazine(
      rows("vn1,shell.150,20,,", "vn1,shell.150,6,,"),
      "book.csv",
    );
    expect(parsed.magazine.lotCount).toBe(1);
    expect(parsed.magazine.onHand("shell.150")).toBe(26);
  });

  it("keeps two lots of the same effect apart", () => {
    const parsed = parseMagazine(
      rows("vn1,shell.150,20,,", "vn2,shell.150,6,,"),
      "book.csv",
    );
    expect(parsed.magazine.lotCount).toBe(2);
  });

  it("accepts a row with no date or note", () => {
    const parsed = parseMagazine(rows("vn1,shell.150,20,,"), "book.csv");
    expect(parsed.diagnostics.size).toBe(0);
    const lot = parsed.magazine.lotsFor("shell.150")[0];
    expect("received" in (lot ?? {})).toBe(false);
    expect("note" in (lot ?? {})).toBe(false);
  });

  it("accepts a quantity of zero", () => {
    const parsed = parseMagazine(rows("vn1,shell.150,0,,"), "book.csv");
    expect(parsed.diagnostics.size).toBe(0);
    expect(parsed.magazine.onHand("shell.150")).toBe(0);
  });
});

describe("bad rows", () => {
  it("refuses a row with no lot number", () => {
    const parsed = parseMagazine(rows(",shell.150,20,,"), "book.csv");
    expect(parsed.diagnostics.byCode("PF1302")[0]?.help).toContain("recall");
  });

  it("refuses an unusable effect name", () => {
    expect(
      parseMagazine(rows("vn1,Shell 150,20,,"), "book.csv").diagnostics.byCode(
        "PF1303",
      ),
    ).toHaveLength(1);
  });

  it("refuses a quantity that is blank, fractional or negative", () => {
    const parsed = parseMagazine(
      rows("vn1,a,,,", "vn2,b,2.5,,", "vn3,c,-4,,"),
      "book.csv",
    );
    expect(parsed.diagnostics.byCode("PF1304")).toHaveLength(3);
  });

  it("warns about a date that will not sort but keeps the row", () => {
    const parsed = parseMagazine(
      rows("vn1,shell.150,20,2 April 2025,"),
      "book.csv",
    );
    expect(parsed.diagnostics.byCode("PF1305")).toHaveLength(1);
    expect(parsed.magazine.onHand("shell.150")).toBe(20);
  });

  it("keeps reading after a bad row", () => {
    const parsed = parseMagazine(
      rows("vn1,a,nonsense,,", "vn2,shell.150,10,,"),
      "book.csv",
    );
    expect(parsed.magazine.onHand("shell.150")).toBe(10);
  });
});

describe("writeMagazine", () => {
  it("round trips", () => {
    const source = rows(
      "vn1,shell.150,20,2025-04-02,april",
      "vn2,shell.75,60,,",
    );
    const first = parseMagazine(source, "book.csv").magazine;
    const second = parseMagazine(writeMagazine(first), "again.csv").magazine;
    expect(second.onHand("shell.150")).toBe(20);
    expect(second.onHand("shell.75")).toBe(60);
    expect(second.lotCount).toBe(2);
  });

  it("writes a header even for an empty book", () => {
    const parsed = parseMagazine(rows(), "book.csv");
    expect(writeMagazine(parsed.magazine)).toBe(HEADER);
  });
});
