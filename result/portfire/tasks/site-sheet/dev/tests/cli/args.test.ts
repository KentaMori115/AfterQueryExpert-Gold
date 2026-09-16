import { describe, expect, it } from "vitest";
import {
  flagHelp,
  numberOf,
  parseArgs,
  requireNumber,
  switchOn,
  valueOf,
} from "../../src/cli/args.js";
import type { FlagSpec } from "../../src/cli/args.js";

const specs: readonly FlagSpec[] = [
  { name: "verbose", kind: "switch", help: "say more" },
  { name: "rig", kind: "value", help: "the rig sheet" },
  { name: "frame", kind: "value", help: "frame rate", fallback: "25" },
  {
    name: "address",
    kind: "value",
    help: "address style",
    choices: ["dotted", "flat"],
  },
];

describe("positional arguments", () => {
  it("collects bare words", () => {
    expect(parseArgs(["show.pf", "out.csv"], specs).positional).toEqual([
      "show.pf",
      "out.csv",
    ]);
  });

  it("treats everything after a double dash as positional", () => {
    const args = parseArgs(["--", "--rig", "x"], specs);
    expect(args.positional).toEqual(["--rig", "x"]);
    expect(args.errors).toEqual([]);
  });

  it("keeps a lone dash as positional, since that means stdin", () => {
    expect(parseArgs(["-"], specs).positional).toEqual(["-"]);
  });
});

describe("switches", () => {
  it("reads a switch", () => {
    const args = parseArgs(["--verbose"], specs);
    expect(switchOn(args, "verbose")).toBe(true);
    expect(switchOn(args, "quiet")).toBe(false);
  });

  it("refuses a value on a switch", () => {
    expect(parseArgs(["--verbose=yes"], specs).errors[0]).toContain(
      "does not take a value",
    );
  });
});

describe("values", () => {
  it("reads a value as the next argument", () => {
    expect(valueOf(parseArgs(["--rig", "autumn.rig"], specs), "rig")).toBe(
      "autumn.rig",
    );
  });

  it("reads a value joined with an equals", () => {
    expect(valueOf(parseArgs(["--rig=autumn.rig"], specs), "rig")).toBe(
      "autumn.rig",
    );
  });

  it("keeps a value that looks like a flag when it was joined", () => {
    expect(valueOf(parseArgs(["--rig=--odd"], specs), "rig")).toBe("--odd");
  });

  it("refuses a value flag with nothing after it", () => {
    expect(parseArgs(["--rig"], specs).errors[0]).toContain("needs a value");
  });

  it("refuses a flag as a separate value", () => {
    expect(parseArgs(["--rig", "--verbose"], specs).errors[0]).toContain(
      "needs a value",
    );
  });

  it("fills in a fallback", () => {
    expect(valueOf(parseArgs([], specs), "frame")).toBe("25");
    expect(valueOf(parseArgs(["--frame", "30"], specs), "frame")).toBe("30");
  });

  it("leaves a value with no fallback undefined", () => {
    expect(valueOf(parseArgs([], specs), "rig")).toBeUndefined();
  });

  it("reads a number", () => {
    expect(numberOf(parseArgs(["--frame", "30"], specs), "frame")).toBe(30);
    expect(
      numberOf(parseArgs(["--frame", "many"], specs), "frame"),
    ).toBeUndefined();
    expect(numberOf(parseArgs([], specs), "rig")).toBeUndefined();
  });
});

describe("choices", () => {
  it("accepts one of the choices", () => {
    expect(valueOf(parseArgs(["--address", "flat"], specs), "address")).toBe(
      "flat",
    );
  });

  it("refuses anything else and lists them", () => {
    const error = parseArgs(["--address", "hex"], specs).errors[0];
    expect(error).toContain("dotted, flat");
  });
});

describe("mistakes", () => {
  it("names an unknown flag", () => {
    expect(parseArgs(["--nonsense"], specs).errors[0]).toBe(
      "unknown flag --nonsense",
    );
  });

  it("suggests a near miss", () => {
    expect(parseArgs(["--verb"], specs).errors[0]).toContain(
      "did you mean --verbose",
    );
  });

  it("matches a suggestion across hyphens", () => {
    const withHyphen: FlagSpec[] = [
      { name: "pre-roll", kind: "switch", help: "absorb it" },
    ];
    expect(parseArgs(["--preroll"], withHyphen).errors[0]).toContain(
      "--pre-roll",
    );
  });

  it("refuses a short flag and says why", () => {
    expect(parseArgs(["-v"], specs).errors[0]).toContain("long flags only");
  });

  it("collects every mistake rather than the first", () => {
    expect(parseArgs(["--nonsense", "--other"], specs).errors).toHaveLength(2);
  });
});

describe("flagHelp", () => {
  it("lines the names up and shows defaults and choices", () => {
    const help = flagHelp(specs);
    expect(help).toContain("--verbose");
    expect(help).toContain("(default 25)");
    expect(help).toContain("[dotted|flat]");
  });

  it("renders nothing for no flags", () => {
    expect(flagHelp([])).toBe("");
  });
});

describe("requireNumber", () => {
  const rules: FlagSpec[] = [
    { name: "count", kind: "value", help: "how many" },
    { name: "size", kind: "value", help: "how big", fallback: "10" },
  ];

  it("reads a number", () => {
    const check = requireNumber(parseArgs(["--count", "4"], rules), "count");
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value).toBe(4);
    }
  });

  it("reads a fallback", () => {
    const check = requireNumber(parseArgs([], rules), "size");
    expect(check.ok && check.value).toBe(10);
  });

  it("refuses a flag that was not given", () => {
    const check = requireNumber(parseArgs([], rules), "count");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("needs a value");
    }
  });

  it("refuses text and names it", () => {
    const check = requireNumber(parseArgs(["--count", "soon"], rules), "count");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("soon");
    }
  });

  it("refuses a fraction when a whole number was wanted", () => {
    const check = requireNumber(parseArgs(["--count", "2.5"], rules), "count", {
      integer: true,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain("whole number");
    }
  });

  it("enforces a minimum and a maximum", () => {
    const low = requireNumber(parseArgs(["--count", "0"], rules), "count", {
      min: 1,
    });
    expect(low.ok).toBe(false);
    if (!low.ok) {
      expect(low.reason).toContain("at least 1");
    }
    const high = requireNumber(parseArgs(["--count", "99"], rules), "count", {
      max: 8,
    });
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(high.reason).toContain("at most 8");
    }
  });

  it("accepts a value on the boundary", () => {
    const check = requireNumber(parseArgs(["--count", "8"], rules), "count", {
      min: 1,
      max: 8,
    });
    expect(check.ok).toBe(true);
  });

  it("refuses infinity", () => {
    const check = requireNumber(
      parseArgs(["--count", "Infinity"], rules),
      "count",
    );
    expect(check.ok).toBe(false);
  });
});
