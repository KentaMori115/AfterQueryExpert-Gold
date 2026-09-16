import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter",
  "shell.150,shell,six inch palm,150mm,palm,2.4,140",
  "shell.75,shell,three inch,75mm,peony,1.8,60",
].join("\n");

const RIG = [
  "position pad.a at 0 0",
  "position pad.b at 40 0",
  "module 1 fc-32 at pad.a",
  "module 2 fc-32 at pad.b",
].join("\n");

const ONE = [
  "show autumn",
  "at 20 fire shell.150 from pad.a pin 1.01",
  "at 22 fire shell.75 from pad.a pin 1.02",
].join("\n");

const MOVED = [
  "show autumn",
  "at 21 fire shell.150 from pad.a pin 1.01",
  "at 23 fire shell.75 from pad.a pin 1.02",
].join("\n");

const REWIRED = [
  "show autumn",
  "at 20 fire shell.150 from pad.a pin 1.01",
  "at 22 fire shell.75 from pad.a pin 1.02",
  "at 30 fire shell.75 from pad.b pin 2.01",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "one.pf": ONE,
    "moved.pf": MOVED,
    "rewired.pf": REWIRED,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

describe("diff", () => {
  it("says nothing changed between a show and itself", () => {
    const env = envWith();
    expect(main(["diff", "one.pf", "--against", "one.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("nothing changed");
    expect(env.stdout).toContain("field is unchanged");
  });

  it("passes a revision that only moved cues", () => {
    const env = envWith();
    expect(
      main(["diff", "moved.pf", "--against", "one.pf", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("2 moved");
    expect(env.stdout).toContain("reload the panel");
  });

  it("fails a revision that needs rewiring", () => {
    const env = envWith();
    expect(
      main(["diff", "rewired.pf", "--against", "one.pf", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stdout).toContain("has to be rewired");
  });

  it("needs an earlier script", () => {
    const env = envWith();
    expect(main(["diff", "one.pf", ...base], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("needs --against");
  });

  it("reports an earlier script it cannot read", () => {
    const env = envWith();
    expect(main(["diff", "one.pf", "--against", "gone.pf", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
  });

  it("refuses when either side does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["diff", "bad.pf", "--against", "one.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("nothing to compare");
    const other = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(
      main(["diff", "one.pf", "--against", "bad.pf", ...base], other),
    ).toBe(EXIT_SHOW_PROBLEM);
  });

  it("lists the pins to visit on request", () => {
    const env = envWith();
    main(["diff", "rewired.pf", "--against", "one.pf", "--walk", ...base], env);
    expect(env.stdout).toContain("visit these pins: 02.01");
  });

  it("says no pin has to be touched for a move only change", () => {
    const env = envWith();
    main(["diff", "moved.pf", "--against", "one.pf", "--walk", ...base], env);
    expect(env.stdout).toContain("no pin has to be touched");
  });

  it("summarises by position on request", () => {
    const env = envWith();
    main(
      ["diff", "rewired.pf", "--against", "one.pf", "--by-position", ...base],
      env,
    );
    expect(env.stdout).toContain("pad.b: 1 changes");
  });
});

describe("hazard", () => {
  it("reports the net quantity and the division", () => {
    const env = envWith();
    expect(main(["hazard", "one.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("net explosive quantity");
    expect(env.stdout).toContain("1.3G");
    expect(env.stdout).toContain("UN0335");
  });

  it("lists the heaviest items", () => {
    const env = envWith();
    main(["hazard", "one.pf", ...base], env);
    expect(env.stdout).toContain("net grams");
    expect(env.stdout).toContain("shell.150");
  });

  it("can be told not to list any", () => {
    const env = envWith();
    main(["hazard", "one.pf", "--top", "0", ...base], env);
    expect(env.stdout).not.toContain("net grams");
  });

  it("checks a store capacity", () => {
    const env = envWith();
    expect(main(["hazard", "one.pf", "--store", "100", ...base], env)).toBe(
      EXIT_OK,
    );
  });

  it("fails a store that is too small", () => {
    const env = envWith();
    expect(main(["hazard", "one.pf", "--store", "0.1", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("PF1700");
  });

  it("fails a licence that does not cover the division", () => {
    const env = envWith();
    expect(
      main(
        ["hazard", "one.pf", "--store", "100", "--divisions", "1.4S", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1702");
  });

  it("refuses a nonsense capacity or division list", () => {
    const env = envWith();
    expect(main(["hazard", "one.pf", "--store", "0", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(
      main(
        [
          "hazard",
          "one.pf",
          "--store",
          "10",
          "--divisions",
          "nonsense",
          ...base,
        ],
        envWith(),
      ),
    ).toBe(EXIT_BAD_USAGE);
  });
});
