/**
 * The command line.
 *
 * Every command is a function from the parsed arguments to lines of
 * text, so a command is tested by calling it and reading what came
 * back. The things worth testing are the ones a command line gets wrong
 * quietly: a mistyped option that leaves a default in place, a name
 * given twice, and an argument that means one thing in the units it was
 * written in and another in the units it was read in.
 */

import { describe, expect, it } from "vitest";
import { commandNamed, commands, nearest, run, usage } from "../src/cli/main.ts";
import { flag, namesUsed, number, onlyKnown, option, parseArgs, quantity, required, unknown, word } from "../src/cli/args.ts";
import { VERSION } from "../src/version.ts";
import { WindingError } from "../src/errors.ts";

describe("reading a command line", () => {
  it("takes loose words, named values and flags apart", () => {
    const one = parseArgs(["examples/bolsover.winder", "--diameter", "52mm", "--sweep"]);
    expect(one.loose).toEqual(["examples/bolsover.winder"]);
    expect(one.named.diameter).toBe("52mm");
    expect(one.flags).toEqual(["sweep"]);
  });

  it("takes a name with no value after it as a flag", () => {
    const one = parseArgs(["--bars", "--depth", "942m"]);
    expect(flag(one, "bars")).toBe(true);
    expect(option(one, "depth")).toBe("942m");
  });

  it("refuses a name given twice and a bare pair of dashes", () => {
    expect(() => parseArgs(["--depth", "942m", "--depth", "600m"])).toThrow(/twice/);
    expect(() => parseArgs(["--"])).toThrow(WindingError);
  });

  it("reads a value in the units it was written in", () => {
    const one = parseArgs(["--diameter", "2in", "--full", "600fpm", "--depth", "515fm"]);
    expect(quantity(one, "diameter")).toBeCloseTo(0.0508, 5);
    expect(quantity(one, "full")).toBeCloseTo(3.048, 3);
    expect(quantity(one, "depth")).toBeCloseTo(941.83, 1);
  });

  it("refuses a quantity without a unit", () => {
    expect(() => quantity(parseArgs(["--depth", "942"]), "depth")).toThrow(WindingError);
  });

  it("takes a plain number where a plain number is meant", () => {
    expect(number(parseArgs(["--grade", "1960"]), "grade")).toBe(1960);
    expect(number(parseArgs([]), "grade", 1770)).toBe(1770);
    expect(() => number(parseArgs(["--grade", "high"]), "grade")).toThrow(WindingError);
    expect(() => number(parseArgs([]), "grade")).toThrow(/--grade/);
  });

  it("wants a loose word where a file is meant", () => {
    expect(word(parseArgs(["a.winder"]), 0, "a winder file")).toBe("a.winder");
    expect(() => word(parseArgs([]), 0, "a winder file")).toThrow(/winder file/);
    expect(() => required(parseArgs([]), "depth")).toThrow(/--depth/);
  });

  it("names what it does not understand rather than ignoring it", () => {
    const one = parseArgs(["--depth", "942m", "--dimeter", "52mm"]);
    expect(namesUsed(one)).toEqual(["depth", "dimeter"]);
    expect(unknown(one, ["depth", "diameter"])).toEqual(["dimeter"]);
    expect(() => onlyKnown(one, ["depth", "diameter"])).toThrow(/dimeter/);
  });
});

describe("the program itself", () => {
  it("says what it does when it is asked", () => {
    for (const each of [[], ["--help"], ["help"], ["-h"]]) {
      const found = run(each);
      expect(found.code).toBe(0);
      expect(found.lines.join("\n")).toContain("usage: sheave");
    }
  });

  it("says its version", () => {
    expect(run(["--version"]).lines).toEqual([VERSION]);
    expect(run(["version"]).lines).toEqual([VERSION]);
  });

  it("lists every command in the usage", () => {
    const said = usage().join("\n");
    for (const each of commands()) expect(said, each.name).toContain(each.name);
  });

  it("guesses at a mistyped command and not at a word that is not one", () => {
    expect(nearest("rop")).toBe("rope");
    expect(nearest("drumm")).toBe("drum");
    expect(nearest("photosynthesis")).toBeUndefined();
  });

  it("says so, with a guess, when the command is not one", () => {
    const found = run(["drumm"]);
    expect(found.code).toBe(2);
    expect(found.lines[0]).toContain("no command called");
    expect(found.lines[1]).toContain("drum");
  });

  it("finds a command by name and refuses one that is not there", () => {
    expect(commandNamed("audit").name).toBe("audit");
    expect(() => commandNamed("hoist")).toThrow(WindingError);
  });

  it("gives every command a name and a line about itself", () => {
    expect(commands().length).toBeGreaterThan(15);
    for (const each of commands()) {
      expect(each.name.length, each.name).toBeGreaterThan(3);
      expect(each.says.length, each.name).toBeGreaterThan(20);
    }
  });

  it("brings a refusal back as a line and an exit code, not as a throw", () => {
    const found = run(["rope", "--dimeter", "52mm"]);
    expect(found.code).toBe(1);
    expect(found.lines[0]).toContain("dimeter");
  });
});

describe("what each command says", () => {
  const said = (argv: readonly string[]): string => {
    const found = run(argv);
    expect(found.code, argv.join(" ")).toBe(0);
    return found.lines.join("\n");
  };

  it("runs the rope commands", () => {
    expect(said(["rope", "--sweep", "--constructions"])).toContain("breaking length");
    expect(said(["wear", "--sweep"])).toContain("condemned at");
    expect(said(["capel"])).toContain("recapping");
  });

  it("runs the shaft and drive commands", () => {
    expect(said(["shaft", "--sweep"])).toContain("free area");
    expect(said(["guides", "--sweep"])).toContain("stiffness");
    expect(said(["drum", "--sweep"])).toContain("fleet angle");
    expect(said(["koepe", "--sweep"])).toContain("capstan");
  });

  it("runs the conveyance, cycle and power commands", () => {
    expect(said(["conveyance", "--compare"])).toContain("useful fraction");
    expect(said(["cycle", "--sweep", "--bars"])).toContain("standing");
    expect(said(["power", "--sweep"])).toContain("r.m.s.");
    expect(said(["safety", "--sweep"])).toContain("curve");
  });

  it("runs the four that read a winder file", () => {
    expect(said(["winder", "examples/bolsover.winder", "--year"])).toContain("Bolsover");
    expect(said(["checks", "examples/bolsover.winder"])).toContain("factor");
    expect(said(["audit", "examples/wheal-jane.winder"])).toContain("error");
    expect(said(["cost", "examples/bolsover.winder", "--bars"])).toContain("a tonne");
    expect(said(["works", "examples/bolsover.winder"])).toContain("shortest");
  });

  it("runs size", () => {
    expect(said(["size", "--compare", "--sweep"])).toContain("payload");
  });

  it("refuses an option no command takes, in every command", () => {
    for (const each of commands()) {
      const found = run([each.name, "examples/bolsover.winder", "--nonsense", "1"]);
      expect(found.code, each.name).toBe(1);
      expect(found.lines.join(" "), each.name).toContain("nonsense");
    }
  });

  it("tells the two examples apart", () => {
    expect(said(["audit", "examples/bolsover.winder"])).toContain("0 errors");
    expect(said(["audit", "examples/wheal-jane.winder"])).not.toContain("0 errors");
  });
});
