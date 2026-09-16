import { describe, expect, it } from "vitest";
import {
  checkId,
  compareIds,
  cueId,
  depthOf,
  effectId,
  isUnder,
  isValidId,
  joinId,
  leafOf,
  moduleId,
  namespaceOf,
  positionId,
  segments,
  showId,
  sortIds,
} from "../../src/core/ids.js";

describe("checkId", () => {
  it("accepts a dotted lowercase name", () => {
    expect(checkId("shell.150.crackling-palm")).toBeUndefined();
    expect(checkId("pad_a")).toBeUndefined();
    expect(checkId("m12")).toBeUndefined();
  });

  it("rejects an empty name", () => {
    expect(checkId("")?.kind).toBe("empty");
  });

  it("rejects uppercase and says why", () => {
    const problem = checkId("Shell.150");
    expect(problem?.kind).toBe("uppercase");
    expect(problem?.detail).toContain("lowercase");
  });

  it("rejects an empty segment", () => {
    expect(checkId("shell..150")?.kind).toBe("empty-segment");
    expect(checkId(".shell")?.kind).toBe("empty-segment");
    expect(checkId("shell.")?.kind).toBe("empty-segment");
  });

  it("rejects a space or a slash", () => {
    expect(checkId("crackling palm")?.kind).toBe("bad-character");
    expect(checkId("shell/150")?.kind).toBe("bad-character");
  });

  it("rejects a segment starting with a hyphen", () => {
    expect(checkId("-palm")?.kind).toBe("bad-character");
  });

  it("rejects a name that is far too long", () => {
    expect(checkId("a".repeat(200))?.kind).toBe("too-long");
  });

  it("agrees with isValidId", () => {
    expect(isValidId("shell.150")).toBe(true);
    expect(isValidId("Shell")).toBe(false);
  });
});

describe("constructors", () => {
  it("brand a valid name", () => {
    expect(effectId("shell.150")).toBe("shell.150");
    expect(positionId("pad.a")).toBe("pad.a");
    expect(cueId("cue-0042")).toBe("cue-0042");
    expect(moduleId("m12")).toBe("m12");
    expect(showId("autumn-2025")).toBe("autumn-2025");
  });

  it("throw with the kind of name in the message", () => {
    expect(() => effectId("Shell")).toThrow(/bad effect name/);
    expect(() => positionId("pad a")).toThrow(/bad position name/);
    expect(() => cueId("")).toThrow(/bad cue name/);
    expect(() => moduleId("M12")).toThrow(/bad module name/);
    expect(() => showId("a.")).toThrow(/bad show name/);
  });
});

describe("structure", () => {
  it("splits into segments", () => {
    expect(segments(effectId("shell.150.palm"))).toEqual([
      "shell",
      "150",
      "palm",
    ]);
  });

  it("reads the namespace and the leaf", () => {
    const id = effectId("shell.150.palm");
    expect(namespaceOf(id)).toBe("shell.150");
    expect(leafOf(id)).toBe("palm");
  });

  it("has no namespace for a bare name", () => {
    const id = effectId("mine");
    expect(namespaceOf(id)).toBeUndefined();
    expect(leafOf(id)).toBe("mine");
  });

  it("counts depth", () => {
    expect(depthOf(effectId("shell.150.palm"))).toBe(3);
    expect(depthOf(effectId("mine"))).toBe(1);
  });
});

describe("isUnder", () => {
  it("matches on a segment boundary", () => {
    const id = effectId("shell.150.palm");
    expect(isUnder(id, "shell")).toBe(true);
    expect(isUnder(id, "shell.150")).toBe(true);
    expect(isUnder(id, "shell.150.palm")).toBe(true);
  });

  it("does not match a partial segment", () => {
    expect(isUnder(effectId("shellac.4"), "shell")).toBe(false);
  });

  it("does not match a longer prefix", () => {
    expect(isUnder(effectId("shell"), "shell.150")).toBe(false);
  });
});

describe("compareIds", () => {
  it("orders numeric segments numerically", () => {
    expect(compareIds("shell.75", "shell.150")).toBeLessThan(0);
    expect(compareIds("shell.150", "shell.75")).toBeGreaterThan(0);
  });

  it("orders text segments alphabetically", () => {
    expect(compareIds("cake.gold", "cake.silver")).toBeLessThan(0);
  });

  it("puts a shorter name before its own extension", () => {
    expect(compareIds("shell", "shell.75")).toBeLessThan(0);
  });

  it("says equal names are equal", () => {
    expect(compareIds("shell.75", "shell.75")).toBe(0);
  });

  it("does not compare a number against a word numerically", () => {
    expect(compareIds("shell.75", "shell.big")).toBeLessThan(0);
  });

  it("sorts a catalog the way a person reads it", () => {
    const sorted = sortIds([
      "shell.150.palm",
      "shell.75.peony",
      "cake.silver",
      "shell.100.willow",
    ]);
    expect(sorted).toEqual([
      "cake.silver",
      "shell.75.peony",
      "shell.100.willow",
      "shell.150.palm",
    ]);
  });
});

describe("joinId", () => {
  it("joins parts with dots", () => {
    expect(joinId("shell", "150", "palm")).toBe("shell.150.palm");
  });

  it("drops empty parts rather than leaving a double dot", () => {
    expect(joinId("shell", "", "palm")).toBe("shell.palm");
    expect(joinId()).toBe("");
  });
});
