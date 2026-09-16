import { describe, expect, it } from "vitest";
import { formatFixed, parseFixed, DEFAULT_SCALE } from "@biomeweaver/fixed-point";

describe("locale independence", () => {
  it("does not change numeric output when the host locale changes", () => {
    const previous = process.env["LC_ALL"];
    process.env["LC_ALL"] = "de-DE";
    try {
      expect(formatFixed(parseFixed("7.250000", DEFAULT_SCALE), DEFAULT_SCALE)).toBe("7.250000");
    } finally {
      if (previous === undefined) {
        delete process.env["LC_ALL"];
      } else {
        process.env["LC_ALL"] = previous;
      }
    }
  });
});
