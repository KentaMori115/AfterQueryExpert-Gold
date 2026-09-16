import { assertionsIntact } from "../safety/siteGuard.js";
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

const RIG = ["position pad.a at 0 0", "module 1 fc-32 at pad.a"].join("\n");

const SMALL = ["show autumn", "at 20 fire shell.75 from pad.a"].join("\n");
const BIG = ["show autumn", "at 20 fire shell.150 from pad.a"].join("\n");

// The hedge sits 90 m north of the only position. A three inch lands a 45 m
// disc, a six inch a 105 m one. The cottage is 600 m off.
const SHEET = [
  "site water meadow",
  "audience -300 -150 300 -150",
  "hard hedge -300 90 300 90",
  "soft path -100 40 100 40",
  "house mill.cottage at 0 600 limit 90",
  "house far.farm at 500 700",
].join("\n");

const LOUD = [
  "site water meadow",
  "audience -300 -150 300 -150",
  "house mill.cottage at 0 600 limit 80",
].join("\n");

const BROKEN = ["site water meadow", "hard hedge -300 90 300 90"].join("\n");

// Two hard lines, the wall nearer the only position than the ridge.
const TWO_HARD = [
  "site water meadow",
  "audience -300 -150 300 -150",
  "hard far.ridge -300 260 300 260",
  "hard near.wall -300 130 300 130",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "small.pf": SMALL,
    "big.pf": BIG,
    "meadow.site": SHEET,
    "loud.site": LOUD,
    "broken.site": BROKEN,
    "two.site": TWO_HARD,
    "walk.csv": "pin,state\n01.01,ok",
    ...over,
  });
}

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];

describe("check with a site sheet", () => {
  it("passes a show that stays inside the sheet", () => {
    assertionsIntact();
    const env = envWith();
    expect(
      main(["check", "small.pf", "--site", "meadow.site", ...base], env),
    ).toBe(EXIT_OK);
  });

  it("fails fallout over the sheet's hard boundary", () => {
    const env = envWith();
    expect(
      main(["check", "big.pf", "--site", "meadow.site", ...base], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF4102");
    expect(env.stderr).toContain("hedge");
  });

  it("refuses a sheet beside an audience distance, and takes either alone", () => {
    const sheet = envWith();
    expect(
      main(["check", "small.pf", "--site", "meadow.site", ...base], sheet),
    ).toBe(EXIT_OK);
    const distance = envWith();
    expect(
      main(["check", "small.pf", "--audience", "200", ...base], distance),
    ).toBe(EXIT_OK);
    const both = envWith();
    expect(
      main(
        [
          "check",
          "small.pf",
          "--site",
          "meadow.site",
          "--audience",
          "200",
          ...base,
        ],
        both,
      ),
    ).toBe(EXIT_BAD_USAGE);
  });

  it("reports a sheet it cannot read once a readable one works", () => {
    const works = envWith();
    expect(
      main(["check", "small.pf", "--site", "meadow.site", ...base], works),
    ).toBe(EXIT_OK);
    const gone = envWith();
    expect(
      main(["check", "small.pf", "--site", "gone.site", ...base], gone),
    ).not.toBe(EXIT_OK);
  });

  it("reports a sheet that will not parse and does not pass the show", () => {
    assertionsIntact();
    const env = envWith();
    expect(
      main(["check", "small.pf", "--site", "broken.site", ...base], env),
    ).not.toBe(EXIT_OK);
    expect(env.stderr).toContain("error");
  });

  it("takes the bearing as where the wind blows from, not towards", () => {
    const south = envWith();
    expect(
      main(
        [
          "check",
          "small.pf",
          "--site",
          "meadow.site",
          "--wind",
          "10",
          "--wind-from",
          "180",
          ...base,
        ],
        south,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(south.stderr).toContain("PF4102");

    const north = envWith();
    expect(
      main(
        [
          "check",
          "small.pf",
          "--site",
          "meadow.site",
          "--wind",
          "10",
          "--wind-from",
          "0",
          ...base,
        ],
        north,
      ),
    ).toBe(EXIT_OK);
  });

  it("leaves a hedge across the wind alone", () => {
    const east = envWith();
    expect(
      main(
        [
          "check",
          "small.pf",
          "--site",
          "meadow.site",
          "--wind",
          "10",
          "--wind-from",
          "90",
          ...base,
        ],
        east,
      ),
    ).toBe(EXIT_OK);
  });

  it("fails a house whose limit the show passes", () => {
    const env = envWith();
    expect(main(["check", "big.pf", "--site", "loud.site", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("PF4200");
  });

  it("passes the same show at a house with a higher limit", () => {
    const quiet = envWith({
      "quiet.site": [
        "audience -300 -150 300 -150",
        "house mill.cottage at 0 600 limit 90",
      ].join("\n"),
    });
    expect(
      main(["check", "big.pf", "--site", "quiet.site", ...base], quiet),
    ).toBe(EXIT_OK);
  });
});

describe("the other show commands with a sheet", () => {
  it("draws the boundaries and the houses on the plan", () => {
    assertionsIntact();
    const env = envWith();
    expect(
      main(["plan", "small.pf", "--site", "meadow.site", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("#");
    expect(env.stdout).toContain("-");
    expect(env.stdout).toContain("A pad.a");
    expect(env.stdout).toContain("H mill.cottage");
    expect(env.stdout).toContain("H far.farm");
  });

  it("names the sheet's site on the permit", () => {
    const env = envWith();
    expect(
      main(["permit", "small.pf", "--site", "meadow.site", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("at water meadow");
  });

  it("lets --site-name win over the sheet", () => {
    const env = envWith();
    main(
      [
        "permit",
        "small.pf",
        "--site",
        "meadow.site",
        "--site-name",
        "long field",
        ...base,
      ],
      env,
    );
    expect(env.stdout).toContain("at long field");
    expect(env.stdout).not.toContain("at water meadow");
  });

  it("prints a site section with the closest line and every house", () => {
    const env = envWith();
    main(["permit", "small.pf", "--site", "meadow.site", ...base], env);
    expect(env.stdout).toContain("hedge");
    expect(env.stdout).toContain("mill.cottage");
    expect(env.stdout).toContain("far.farm");
  });

  it("quotes the nearer of two hard boundaries, at its own distance", () => {
    const env = envWith();
    main(["permit", "small.pf", "--site", "two.site", ...base], env);
    expect(env.stdout).toContain("near.wall");
    expect(env.stdout).toContain("130");
    expect(env.stdout).not.toContain("far.ridge");
  });

  it("passes over a soft line closer than the nearest hard one", () => {
    // The path lies 40 m out and the hedge 90 m; only hard lines are quoted.
    const env = envWith();
    main(["permit", "small.pf", "--site", "meadow.site", ...base], env);
    expect(env.stdout).toContain("hedge");
    expect(env.stdout).toContain("90");
    expect(env.stdout).not.toContain("path");
  });

  it("puts the sheet's permit into the pack", () => {
    assertionsIntact();
    const env = envWith();
    expect(
      main(["pack", "small.pf", "--site", "meadow.site", ...base], env),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("permit");
    expect(env.stdout).toContain("at water meadow");
  });

  it("lets --site-name win over the sheet in the pack as well", () => {
    const env = envWith();
    main(
      [
        "pack",
        "small.pf",
        "--site",
        "meadow.site",
        "--site-name",
        "long field",
        ...base,
      ],
      env,
    );
    expect(env.stdout).toContain("at long field");
    expect(env.stdout).not.toContain("at water meadow");
  });

  it("takes the sheet on the table and sheet commands too", () => {
    const table = envWith();
    expect(
      main(["table", "small.pf", "--site", "meadow.site", ...base], table),
    ).toBe(EXIT_OK);
    const sheet = envWith();
    expect(
      main(["sheet", "small.pf", "--site", "meadow.site", ...base], sheet),
    ).toBe(EXIT_OK);
  });
});

describe("every show command", () => {
  // Each of these compiles one show and differs only in what it prints, so a
  // sheet has to reach all of them, not the handful that read it back out.
  // Two of them want an argument of their own before they will read a show.
  const COMMANDS: readonly (readonly string[])[] = [
    ["check"],
    ["annotate"],
    ["continuity", "--walk", "walk.csv"],
    ["double"],
    ["explain", "1"],
    ["hazard"],
    ["inventory"],
    ["pack"],
    ["permit"],
    ["plan"],
    ["preview"],
    ["rehearse"],
    ["sheet"],
    ["table"],
  ];

  it("takes a sheet without calling it a usage mistake", () => {
    assertionsIntact();
    const refused: string[] = [];
    for (const [name, ...rest] of COMMANDS) {
      const env = envWith();
      const argv = [
        name!,
        "small.pf",
        ...rest,
        "--site",
        "meadow.site",
        ...base,
      ];
      if (main(argv, env) === EXIT_BAD_USAGE) {
        refused.push(name!);
      }
    }
    expect(refused).toEqual([]);
  });

  it("refuses a sheet beside an audience distance in every one of them", () => {
    // A command that never learned --site refuses it on its own, so each one
    // has to take the sheet alone before its refusal of the pair means a thing.
    const wrong: string[] = [];
    for (const [name, ...rest] of COMMANDS) {
      const alone = envWith();
      const sheetOnly = [
        name!,
        "small.pf",
        ...rest,
        "--site",
        "meadow.site",
        ...base,
      ];
      if (main(sheetOnly, alone) === EXIT_BAD_USAGE) {
        wrong.push(`${name!} refused the sheet alone`);
      }
      const both = envWith();
      const pair = [...sheetOnly, "--audience", "200"];
      if (main(pair, both) !== EXIT_BAD_USAGE) {
        wrong.push(`${name!} took both`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("crowd with a sheet", () => {
  // 600 m of audience line and 20 m of depth hold 24,000 at the default density.
  it("measures the crowd against a surveyed line", () => {
    assertionsIntact();
    const fits = envWith();
    expect(
      main(
        [
          "crowd",
          "--site",
          "meadow.site",
          "--depth",
          "20",
          "--expected",
          "20000",
        ],
        fits,
      ),
    ).toBe(EXIT_OK);
    const packed = envWith();
    expect(
      main(
        [
          "crowd",
          "--site",
          "meadow.site",
          "--depth",
          "20",
          "--expected",
          "30000",
        ],
        packed,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(packed.stderr).toContain("PF4300");
  });

  it("refuses a sheet it cannot read, or none at all, once a sheet works", () => {
    const works = envWith();
    expect(
      main(
        [
          "crowd",
          "--site",
          "meadow.site",
          "--depth",
          "20",
          "--expected",
          "100",
        ],
        works,
      ),
    ).toBe(EXIT_OK);
    const gone = envWith();
    expect(
      main(
        ["crowd", "--site", "gone.site", "--depth", "20", "--expected", "100"],
        gone,
      ),
    ).toBe(EXIT_BAD_USAGE);
    const none = envWith();
    expect(main(["crowd", "--depth", "20", "--expected", "100"], none)).toBe(
      EXIT_BAD_USAGE,
    );
  });
});
