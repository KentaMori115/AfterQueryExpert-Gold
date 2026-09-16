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
].join("\n");

const RIG = [
  "position pad.a at 0 0",
  "module 1 fc-16 at pad.a",
  "lead 20",
].join("\n");

const SHOW = [
  "show autumn",
  "at 20 fire shell.150 from pad.a",
  "at 22 fire shell.150 from pad.a",
].join("\n");

const WALK = ["pin,state", "01.01,ok", "01.02,ok"].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "autumn.pf": SHOW,
    "walk.csv": WALK,
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

describe("permit", () => {
  it("writes the facts", () => {
    const env = envWith();
    expect(
      main(["permit", "autumn.pf", "--audience", "200", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("separation required");
    expect(env.stdout).toContain("shot list");
  });

  it("refuses without an audience distance", () => {
    const env = envWith();
    expect(main(["permit", "autumn.pf", ...base], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("needs --audience");
  });

  it("takes the show and site names and the paperwork fields", () => {
    const env = envWith();
    main(
      [
        "permit",
        "autumn.pf",
        "--audience",
        "200",
        "--show-name",
        "autumn 2025",
        "--site-name",
        "long meadow",
        "--date",
        "2025-11-05",
        "--operator",
        "skye",
        "--licence",
        "abc-1234",
        ...base,
      ],
      env,
    );
    expect(env.stdout).toContain("autumn 2025 at long meadow");
    expect(env.stdout).toContain("abc-1234");
  });

  it("falls back to the script name", () => {
    const env = envWith();
    main(["permit", "autumn.pf", "--audience", "200", ...base], env);
    expect(env.stdout).toContain("autumn.pf");
  });

  it("says the show does not clear on a tight site", () => {
    const env = envWith();
    main(["permit", "autumn.pf", "--audience", "40", ...base], env);
    expect(env.stdout).toContain("clears the rule");
    expect(env.stdout).toContain("no");
  });

  it("writes to a file", () => {
    const env = envWith();
    main(
      [
        "permit",
        "autumn.pf",
        "--audience",
        "200",
        "--out",
        "permit.txt",
        ...base,
      ],
      env,
    );
    expect(env.written.get("permit.txt")).toContain("shot list");
  });
});

describe("continuity", () => {
  it("passes a walk that matches the show", () => {
    const env = envWith();
    expect(
      main(["continuity", "autumn.pf", "--walk", "walk.csv", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("2 pins walked");
    expect(env.stdout).toContain("0 dead cues");
  });

  it("needs a walk", () => {
    const env = envWith();
    expect(main(["continuity", "autumn.pf", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("needs --walk");
  });

  it("reports a walk it cannot read", () => {
    const env = envWith();
    expect(
      main(["continuity", "autumn.pf", "--walk", "gone.csv", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
  });

  it("fails a walk with a dead cue and names the pin", () => {
    const env = envWith({
      "bad.csv": ["pin,state", "01.01,open", "01.02,ok"].join("\n"),
    });
    expect(
      main(["continuity", "autumn.pf", "--walk", "bad.csv", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("01.01");
    expect(env.stderr).toContain("PF1410");
  });

  it("fails a walk with a stray lead", () => {
    const env = envWith({
      "stray.csv": ["pin,state", "01.01,ok", "01.02,ok", "01.09,ok"].join("\n"),
    });
    expect(
      main(["continuity", "autumn.pf", "--walk", "stray.csv", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1412");
  });

  it("stops on a walk that will not parse", () => {
    const env = envWith({ "junk.csv": "a,b\n1,2" });
    expect(
      main(["continuity", "autumn.pf", "--walk", "junk.csv", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1400");
  });

  it("refuses to check a show that does not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(
      main(["continuity", "bad.pf", "--walk", "walk.csv", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("nothing to check against");
  });

  it("checks resistances on request", () => {
    const env = envWith({
      "ohms.csv": ["pin,state,ohms", "01.01,ok,40", "01.02,ok,4.7"].join("\n"),
    });
    main(
      [
        "continuity",
        "autumn.pf",
        "--walk",
        "ohms.csv",
        "--resistance",
        ...base,
      ],
      env,
    );
    expect(env.stderr).toContain("PF1414");
  });

  it("lists the pins the walk never reached", () => {
    const env = envWith();
    main(
      ["continuity", "autumn.pf", "--walk", "walk.csv", "--unwalked", ...base],
      env,
    );
    expect(env.stdout).toContain("never walked:");
    expect(env.stdout).toContain("01.16");
  });

  it("says so when the walk covered everything", () => {
    const rows = ["pin,state"];
    for (let pin = 1; pin <= 16; pin += 1) {
      rows.push(
        `01.${String(pin).padStart(2, "0")},${pin <= 2 ? "ok" : "open"}`,
      );
    }
    const env = envWith({ "full.csv": rows.join("\n") });
    main(
      ["continuity", "autumn.pf", "--walk", "full.csv", "--unwalked", ...base],
      env,
    );
    expect(env.stdout).toContain("covered every pin");
  });
});

describe("explain", () => {
  it("explains a cue by number", () => {
    const env = envWith();
    expect(main(["explain", "autumn.pf", "1", ...base], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("so the panel fires at");
    expect(env.stdout).toContain("fc-16");
  });

  it("explains a cue by pin", () => {
    const env = envWith();
    main(["explain", "autumn.pf", "01.02", ...base], env);
    expect(env.stdout).toContain("01.02");
  });

  it("needs a cue to explain", () => {
    const env = envWith();
    expect(main(["explain", "autumn.pf", ...base], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("name the cue");
  });

  it("says how many cues there are when it cannot find one", () => {
    const env = envWith();
    expect(main(["explain", "autumn.pf", "99", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("has 2 cues");
  });

  it("lists neighbours on request", () => {
    const env = envWith();
    main(["explain", "autumn.pf", "1", "--neighbours", ...base], env);
    expect(env.stdout).toContain("around it");
  });

  it("refuses a nonsense window", () => {
    const env = envWith();
    expect(
      main(["explain", "autumn.pf", "1", "--window", "lots", ...base], env),
    ).toBe(EXIT_BAD_USAGE);
  });
});
