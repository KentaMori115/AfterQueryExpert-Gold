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

const SHOW = [
  "show autumn",
  "at 10 fire shell.150 from pad.a",
  "at 10.2 fire shell.150 from pad.b",
  "at 30 ripple 6 of shell.75 from pad.a every 250ms",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "autumn.pf": SHOW,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

describe("preview", () => {
  it("prints both views by default", () => {
    const env = envWith();
    expect(main(["preview", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("one column is");
    expect(env.stdout).toContain("6in palm");
  });

  it("prints only the chart", () => {
    const env = envWith();
    main(["preview", "autumn.pf", "--kind", "chart", ...base], env);
    expect(env.stdout).toContain("one column is");
    expect(env.stdout).not.toContain("6in palm");
  });

  it("prints only the storyboard", () => {
    const env = envWith();
    main(["preview", "autumn.pf", "--kind", "storyboard", ...base], env);
    expect(env.stdout).toContain("6in palm");
    expect(env.stdout).not.toContain("one column is");
  });

  it("always ends with the density line", () => {
    const env = envWith();
    main(["preview", "autumn.pf", ...base], env);
    expect(env.stdout).toContain("peak");
    expect(env.stdout).toContain("lulls");
  });

  it("takes a slice size and a width", () => {
    const env = envWith();
    main(
      ["preview", "autumn.pf", "--slice", "0.5", "--width", "20", ...base],
      env,
    );
    expect(env.stdout).toContain("one column is 0.5s");
  });

  it("groups a ripple into one moment with a wide window", () => {
    const env = envWith();
    main(
      [
        "preview",
        "autumn.pf",
        "--kind",
        "storyboard",
        "--window",
        "3000",
        ...base,
      ],
      env,
    );
    expect(env.stdout).toContain("6 x 3in peony");
  });

  it("refuses a nonsense slice or width", () => {
    const env = envWith();
    expect(main(["preview", "autumn.pf", "--slice", "0", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("--slice has to be at least");
    const wide = envWith();
    expect(
      main(["preview", "autumn.pf", "--width", "half", ...base], wide),
    ).toBe(EXIT_BAD_USAGE);
    expect(wide.stderr).toContain("--width takes a number");
  });

  it("still previews a show with errors", () => {
    const env = envWith({
      "bad.pf": [
        "at 10 fire shell.999 from pad.a",
        "at 12 fire shell.150 from pad.a",
      ].join("\n"),
    });
    expect(main(["preview", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stdout).toContain("6in palm");
  });

  it("says so for an empty show", () => {
    const env = envWith({ "quiet.pf": "show quiet" });
    main(["preview", "quiet.pf", ...base], env);
    expect(env.stdout).toContain("nothing to preview");
  });
});
