import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const CLEAN = [
  "show autumn",
  "",
  "at 10.0 fire shell.150 from pad.a",
  "at 12.0 ripple 4 of shell.75 from pad.b every 200ms",
  "",
].join("\n");

const MESSY = [
  "at 10 fire shell.150 from pad.a",
  "at 10 fire shell.75 from pad.a",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({ "clean.pf": CLEAN, "messy.pf": MESSY, ...over });
}

describe("lint", () => {
  it("passes a clean script", () => {
    const env = envWith();
    expect(main(["lint", "clean.pf"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("0 errors, 0 warnings");
  });

  it("fails a script with warnings and names them", () => {
    const env = envWith();
    expect(main(["lint", "messy.pf"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2605");
    expect(env.stderr).toContain("PF2607");
  });

  it("needs a script", () => {
    const env = envWith();
    expect(main(["lint"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("reports a script it cannot read", () => {
    const env = envWith();
    expect(main(["lint", "gone.pf"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("fails a script that does not parse", () => {
    const env = envWith({ "broken.pf": "rocket 4" });
    expect(main(["lint", "broken.pf"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2116");
  });

  it("takes its own thresholds", () => {
    const env = envWith();
    expect(main(["lint", "clean.pf", "--quiet-seconds", "1"], env)).toBe(
      EXIT_OK,
    );
    const tight = envWith();
    expect(main(["lint", "clean.pf", "--tight-ms", "500"], tight)).toBe(
      EXIT_SHOW_PROBLEM,
    );
  });

  it("refuses a nonsense threshold", () => {
    const env = envWith();
    expect(main(["lint", "clean.pf", "--tight-ms", "0"], env)).toBe(
      EXIT_BAD_USAGE,
    );
  });

  it("follows includes when asked", () => {
    const env = envWith({
      "top.pf": ["show autumn", 'include "lib.pf"', "at 20 play finale"].join(
        "\n",
      ),
      "lib.pf": ["group finale", "at 0 fire a from b", "end"].join("\n"),
    });
    expect(main(["lint", "top.pf", "--follow"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("2 files");
  });

  it("finds a duplicate group across files", () => {
    const env = envWith({
      "top.pf": [
        "show autumn",
        'include "a.pf"',
        'include "b.pf"',
        "at 20 play finale",
      ].join("\n"),
      "a.pf": ["group finale", "at 0 fire x from y", "end"].join("\n"),
      "b.pf": ["group finale", "at 0 fire z from y", "end"].join("\n"),
    });
    expect(main(["lint", "top.pf", "--follow"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2502");
  });

  it("fails when a followed include is missing", () => {
    const env = envWith({ "top.pf": 'include "gone.pf"' });
    expect(main(["lint", "top.pf", "--follow"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF2500");
  });
});

describe("fmt", () => {
  it("prints the formatted script", () => {
    const env = envWith();
    expect(main(["fmt", "messy.pf"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("at 10.0 fire shell.150 from pad.a");
  });

  it("says a formatted script is already formatted", () => {
    const env = envWith();
    expect(main(["fmt", "clean.pf", "--check"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("already formatted");
  });

  it("fails the check on an unformatted script", () => {
    const env = envWith();
    expect(main(["fmt", "messy.pf", "--check"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("is not formatted");
  });

  it("rewrites in place", () => {
    const env = envWith();
    expect(main(["fmt", "messy.pf", "--write"], env)).toBe(EXIT_OK);
    expect(env.written.get("messy.pf")).toContain("at 10.0 fire");
    expect(env.stdout).toContain("wrote messy.pf");
  });

  it("says so when a rewrite changed nothing", () => {
    const env = envWith();
    main(["fmt", "clean.pf", "--write"], env);
    expect(env.stdout).toContain("was already formatted");
  });

  it("takes an indent width and minute times", () => {
    const env = envWith({
      "group.pf": ["group finale", "at 1:23 fire a from b", "end"].join("\n"),
    });
    main(["fmt", "group.pf", "--indent", "4", "--minutes"], env);
    expect(env.stdout).toContain("    at 1:23.000");
  });

  it("refuses a nonsense indent", () => {
    const env = envWith();
    expect(main(["fmt", "clean.pf", "--indent", "40"], env)).toBe(
      EXIT_BAD_USAGE,
    );
  });

  it("refuses to format a script that does not parse", () => {
    const env = envWith({ "broken.pf": "rocket 4" });
    expect(main(["fmt", "broken.pf"], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("cannot be formatted");
  });

  it("needs a script", () => {
    const env = envWith();
    expect(main(["fmt"], env)).toBe(EXIT_BAD_USAGE);
  });
});
