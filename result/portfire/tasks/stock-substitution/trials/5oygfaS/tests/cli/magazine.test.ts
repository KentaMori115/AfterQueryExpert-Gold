import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
  runCommand,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { lotNumbers } from "../../src/cli/commands/common.js";
import { buildCommands } from "../../src/cli/registry.js";

const commands = buildCommands();

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter",
  "shell.150.palm,shell,six inch palm,150mm,palm,2.6,138",
  "shell.150.kamuro,shell,six inch kamuro,150mm,kamuro,4.2,132",
  "shell.75.peony,shell,three inch peony,75mm,peony,1.8,68",
].join("\n");

const RIG = [
  "position pad.a at 0 0",
  "position pad.b at 40 0",
  "module 1 fc-32 at pad.a",
  "module 2 fc-32 at pad.b",
].join("\n");

const SHOW = [
  "show autumn",
  "at 10 fire shell.150.palm from pad.a label one",
  "at 12 fire shell.150.palm from pad.a label two",
  "at 14 fire shell.150.palm from pad.b label three",
  "at 16 fire shell.75.peony from pad.b label four",
].join("\n");

const BOOK = [
  "lot,effect,quantity,received,note",
  "VN2413,shell.150.palm,1,2025-06-14,",
  "vn2405,shell.150.palm,1,2025-04-02,",
  "vn7,shell.150.kamuro,1,2025-04-02,",
].join("\n");

function envWith(over: Record<string, string> = {}): MemoryEnv {
  return new MemoryEnv({
    "house.csv": CATALOG,
    "autumn.rig": RIG,
    "autumn.pf": SHOW,
    "book.csv": BOOK,
    ...over,
  });
}

const base = [
  "--catalog",
  "house.csv",
  "--rig",
  "autumn.rig",
  "--magazine",
  "book.csv",
];

describe("lotNumbers", () => {
  it("reads a comma separated list in any case", () => {
    expect(lotNumbers("VN2405, vn2413 ")).toEqual(["vn2405", "vn2413"]);
  });

  it("is empty when the flag was not given", () => {
    expect(lotNumbers(undefined)).toEqual([]);
  });

  it("drops a stray comma rather than a blank lot", () => {
    expect(lotNumbers("vn1,,")).toEqual(["vn1"]);
  });
});

describe("check against a magazine", () => {
  it("notes the stand-in and refuses the cue nothing covers", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", "autumn.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("1 shot drawn as shell.150.kamuro");
    expect(env.stderr).toContain("nothing in stock can stand in for");
  });

  it("is clean when the store covers the show", () => {
    const env = envWith({
      "plenty.csv": [
        "lot,effect,quantity",
        "vn1,shell.150.palm,40",
        "vn2,shell.75.peony,40",
      ].join("\n"),
    });
    expect(
      runCommand(
        commands,
        [
          "check",
          "autumn.pf",
          "--catalog",
          "house.csv",
          "--rig",
          "autumn.rig",
          "--magazine",
          "plenty.csv",
        ],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("ready");
  });

  it("sets a pulled lot aside before drawing", () => {
    const env = envWith();
    runCommand(
      commands,
      ["check", "autumn.pf", "--pull", "VN2405", ...base],
      env,
    );
    expect(env.stderr).toContain(
      "nothing in stock can stand in for shell.150.palm",
    );
  });

  it("reports a magazine book it cannot read", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        [
          "check",
          "autumn.pf",
          "--catalog",
          "house.csv",
          "--rig",
          "autumn.rig",
          "--magazine",
          "gone.csv",
        ],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("cannot read the magazine book at gone.csv");
  });
});

describe("the cue sheet against a magazine", () => {
  it("grows a lot column", () => {
    const env = envWith();
    runCommand(commands, ["sheet", "autumn.pf", ...base], env);
    const header = env.stdout
      .split("\n")
      .find((line) => line.includes("position"));
    expect(header).toContain("lot");
    expect(env.stdout).toContain("vn2405");
    expect(env.stdout).toContain("vn2413");
  });

  it("keeps the column even where nothing was drawn", () => {
    const env = envWith({ "empty.csv": "lot,effect,quantity" });
    runCommand(
      commands,
      [
        "sheet",
        "autumn.pf",
        "--catalog",
        "house.csv",
        "--rig",
        "autumn.rig",
        "--magazine",
        "empty.csv",
      ],
      env,
    );
    expect(
      env.stdout.split("\n").find((line) => line.includes("position")),
    ).toContain("lot");
  });

  it("has no lot column without a book", () => {
    const env = envWith();
    runCommand(
      commands,
      ["sheet", "autumn.pf", "--catalog", "house.csv", "--rig", "autumn.rig"],
      env,
    );
    expect(
      env.stdout.split("\n").find((line) => line.includes("position")),
    ).not.toContain("lot");
  });
});

describe("explain a cue that is firing a stand-in", () => {
  it("names the lot and what the script asked for", () => {
    const env = envWith();
    runCommand(commands, ["explain", "autumn.pf", "three", ...base], env);
    expect(env.stdout).toContain("stands in for  shell.150.palm");
    expect(env.stdout).toContain("lot            vn7");
  });

  it("names only the lot on a cue that got what it asked for", () => {
    const env = envWith();
    runCommand(commands, ["explain", "autumn.pf", "one", ...base], env);
    expect(env.stdout).not.toContain("stands in for");
    expect(env.stdout).toContain("vn2405");
  });
});

describe("inventory against a drawn show", () => {
  it("counts what the script asked for, not what will fire", () => {
    const env = envWith();
    expect(runCommand(commands, ["inventory", "autumn.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.150.palm"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.150.palm",
      "3",
      "2",
      "1",
    ]);
  });

  it("lists each stand-in under the shortfall it covers", () => {
    const env = envWith();
    runCommand(commands, ["inventory", "autumn.pf", ...base], env);
    expect(env.stderr).toContain("short 1 of shell.150.palm");
    expect(env.stderr).toContain(
      "  1 shot drawn as shell.150.kamuro from lot vn7",
    );
  });

  it("counts a pulled lot as stock this show does not have", () => {
    const env = envWith();
    runCommand(
      commands,
      ["inventory", "autumn.pf", "--pull", "vn2405", ...base],
      env,
    );
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.150.palm"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.150.palm",
      "3",
      "1",
      "2",
    ]);
  });
});
