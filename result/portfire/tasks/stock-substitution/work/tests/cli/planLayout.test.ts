import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { main } from "../../src/cli/main.js";

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter,duration,style",
  "shell.150,shell,six inch palm,150mm,palm,2.4,140,,",
  "shell.75,shell,three inch,75mm,peony,1.8,60,,",
  "gerb.silver,ground,silver gerb,,,,,20,gerb",
].join("\n");

const RIG = [
  "position pad.a at -60 0",
  "position pad.b at 60 0",
  "module 1 slat-50 at pad.a",
  "module 2 slat-50 at pad.b",
].join("\n");

const SHOW = [
  "show autumn",
  "at 20 ripple 13 of shell.75 from pad.a every 500ms",
  "at 40 ripple 7 of shell.150 from pad.b every 1s",
  "at 60 fire gerb.silver from pad.a",
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

describe("plan", () => {
  it("draws the site", () => {
    const env = envWith();
    expect(main(["plan", "autumn.pf", "--audience", "200", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("north is up");
    expect(env.stdout).toContain("A pad.a");
  });

  it("needs an audience distance", () => {
    const env = envWith();
    expect(main(["plan", "autumn.pf", ...base], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("needs --audience");
  });

  it("takes a size", () => {
    const env = envWith();
    main(
      ["plan", "autumn.pf", "--audience", "200", "--width", "40", ...base],
      env,
    );
    for (const line of env.stdout.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("refuses a nonsense size", () => {
    const env = envWith();
    expect(
      main(
        ["plan", "autumn.pf", "--audience", "200", "--width", "wide", ...base],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
  });

  it("draws rings on request", () => {
    const env = envWith();
    main(["plan", "autumn.pf", "--audience", "300", "--rings", ...base], env);
    expect(env.stdout.split("north is up")[0]).toContain(".");
  });
});

describe("layout", () => {
  it("gives the racks by position and bore", () => {
    const env = envWith();
    expect(main(["layout", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("75mm");
    expect(env.stdout).toContain("150mm");
    expect(env.stdout).toContain("racks");
  });

  it("prints the tube order on request", () => {
    const env = envWith();
    main(["layout", "autumn.pf", "--order", ...base], env);
    expect(env.stdout).toContain("tubes");
  });

  it("names a position carrying two bores", () => {
    const env = envWith({
      "mixed.pf": [
        "show autumn",
        "at 20 fire shell.75 from pad.a",
        "at 30 fire shell.150 from pad.a",
      ].join("\n"),
    });
    main(["layout", "mixed.pf", ...base], env);
    expect(env.stdout).toContain("pad.a carries 150mm and 75mm");
  });

  it("warns when a position needs too many racks", () => {
    const env = envWith();
    expect(
      main(["layout", "autumn.pf", "--max-racks", "1", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1801");
  });

  it("refuses a nonsense rack cap", () => {
    const env = envWith();
    expect(
      main(["layout", "autumn.pf", "--max-racks", "0", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
  });

  it("refuses a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["layout", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("would be a guess");
  });
});

describe("rehearse", () => {
  it("writes a plan a watcher can follow", () => {
    const env = envWith();
    expect(main(["rehearse", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("watch for");
    expect(env.stdout).toContain("light on module");
  });

  it("counts the watchers", () => {
    const env = envWith();
    main(["rehearse", "autumn.pf", ...base], env);
    expect(env.stdout).toMatch(/^\d+ watchers?, \d+ steps?/);
  });

  it("takes its own window", () => {
    const wide = envWith();
    const tight = envWith();
    main(["rehearse", "autumn.pf", "--window", "5000", ...base], wide);
    main(["rehearse", "autumn.pf", "--window", "1", ...base], tight);
    expect(wide.stdout.split("\n").length).toBeLessThan(
      tight.stdout.split("\n").length,
    );
  });

  it("writes to a file", () => {
    const env = envWith();
    main(["rehearse", "autumn.pf", "--out", "dry.txt", ...base], env);
    expect(env.written.get("dry.txt")).toContain("watch for");
  });

  it("refuses a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["rehearse", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("nothing to rehearse");
  });

  it("refuses a nonsense window", () => {
    const env = envWith();
    expect(
      main(["rehearse", "autumn.pf", "--window", "soon", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
  });
});

describe("annotate", () => {
  it("writes the firing time and pins onto each cue", () => {
    const env = envWith();
    expect(main(["annotate", "autumn.pf", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("#> fires");
    expect(env.stdout).toContain("01.01");
  });

  it("can leave the pins out", () => {
    const env = envWith();
    main(["annotate", "autumn.pf", "--no-pins", ...base], env);
    expect(env.stdout).toContain("#> fires");
    expect(env.stdout).not.toContain("01.01");
  });

  it("rewrites in place", () => {
    const env = envWith();
    main(["annotate", "autumn.pf", "--write", ...base], env);
    expect(env.written.get("autumn.pf")).toContain("#> fires");
    expect(env.stdout).toContain("wrote autumn.pf");
  });

  it("strips annotations back off", () => {
    const env = envWith();
    main(["annotate", "autumn.pf", "--write", ...base], env);
    main(["annotate", "autumn.pf", "--strip", "--write", ...base], env);
    expect(env.written.get("autumn.pf")).not.toContain("#>");
  });

  it("needs a script", () => {
    const env = envWith();
    expect(main(["annotate", ...base], env)).toBe(EXIT_BAD_USAGE);
  });

  it("refuses a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(main(["annotate", "bad.pf", ...base], env)).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("would be wrong");
  });

  it("refuses a nonsense pin cap", () => {
    const env = envWith();
    expect(
      main(["annotate", "autumn.pf", "--max-pins", "0", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
  });
});
