import { describe, expect, it } from "vitest";
import {
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
  runCommand,
} from "../../src/cli/command.js";
import { MemoryEnv } from "../../src/cli/env.js";
import { buildCommands } from "../../src/cli/registry.js";

const commands = buildCommands();

const CATALOG = [
  "id,kind,name,calibre,break,hang,diameter",
  "shell.150.palm,shell,six inch palm,150mm,palm,2.4,140",
  "shell.150.willow,shell,six inch willow,150mm,willow,3.0,140",
  "shell.75.peony,shell,three inch peony,75mm,peony,1.8,60",
].join("\n");

const RIG = ["position pad.a at 0 0", "module 1 fc-16 at pad.a"].join("\n");

const SHOW = [
  "show autumn",
  "at 20 fire shell.150.palm from pad.a label opener",
  "at 24 fire shell.150.palm from pad.a",
  "at 28 fire shell.75.peony from pad.a",
].join("\n");

const BOOK = [
  "lot,effect,quantity,received",
  "vn1,shell.150.palm,1,2025-04-02",
  "vn2,shell.150.willow,2,2025-01-05",
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

const base = ["--catalog", "house.csv", "--rig", "autumn.rig"];
const withBook = [...base, "--magazine", "book.csv"];

describe("a show drawn from the magazine", () => {
  it("says what stood in and what nothing could cover", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", "autumn.pf", ...withBook], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("shell.150.willow");
    expect(env.stderr).toContain("PF1600");
    expect(env.stdout).toContain("not ready");
  });

  it("compiles against the catalog alone without a book", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", "autumn.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stderr).not.toContain("PF1601");
  });

  it("sets a pulled lot aside, so even the opener stands in", () => {
    const env = envWith({
      "two.pf": [
        "at 20 fire shell.150.palm from pad.a",
        "at 24 fire shell.150.palm from pad.a",
      ].join("\n"),
    });
    runCommand(
      commands,
      ["table", "two.pf", ...withBook, "--pull", "VN1"],
      env,
    );
    const effects = env.stdout
      .split("\n")
      .slice(1)
      .map((row) => row.split(",")[3]);
    expect(effects.slice(0, 2)).toEqual([
      "shell.150.willow",
      "shell.150.willow",
    ]);
  });

  it("stops when the book cannot be read", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", ...base, "--magazine", "gone.csv"],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("cannot read the magazine book at gone.csv");
  });

  it("reports a book with bad rows and carries on with the rest", () => {
    const env = envWith({
      "half.csv": ["lot,effect,quantity", ",shell.150.palm,4"].join("\n"),
    });
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", ...base, "--magazine", "half.csv"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1302");
  });
});

describe("the cue sheet with a book", () => {
  it("grows a lot column", () => {
    const env = envWith();
    runCommand(commands, ["sheet", "autumn.pf", ...withBook], env);
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn1");
    expect(env.stdout).toContain("vn2");
  });

  it("keeps the column even where nothing could be drawn", () => {
    const env = envWith({
      "empty.csv": ["lot,effect,quantity", "vn9,shell.75.peony,0"].join("\n"),
    });
    runCommand(
      commands,
      ["sheet", "autumn.pf", ...base, "--magazine", "empty.csv"],
      env,
    );
    const header = env.stdout
      .split("\n")
      .find((line) => line.includes("position"));
    expect(header).toContain("lot");
  });

  it("leaves the column out when no book was given", () => {
    const env = envWith();
    runCommand(commands, ["sheet", "autumn.pf", ...base], env);
    const header = env.stdout
      .split("\n")
      .find((line) => line.includes("position"));
    expect(header).not.toContain("lot");
  });
});

describe("explain on a cue that stood in", () => {
  it("names the lot and what the script asked for", () => {
    const env = envWith();
    runCommand(commands, ["explain", "autumn.pf", "2", ...withBook], env);
    expect(env.stdout).toContain("shell.150.willow");
    expect(env.stdout).toContain("stands in for");
    expect(env.stdout).toContain("shell.150.palm");
    expect(env.stdout).toContain("vn2");
  });

  it("names only the lot on a cue that got what it asked for", () => {
    const env = envWith();
    runCommand(commands, ["explain", "autumn.pf", "1", ...withBook], env);
    expect(env.stdout).toContain("vn1");
    expect(env.stdout).not.toContain("stands in for");
  });
});

describe("inventory against a drawn show", () => {
  it("counts what the script asked for and still fails", () => {
    const env = envWith();
    expect(
      runCommand(commands, ["inventory", "autumn.pf", ...withBook], env),
    ).toBe(EXIT_SHOW_PROBLEM);
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.150.palm"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.150.palm",
      "2",
      "1",
      "1",
    ]);
    expect(env.stdout).not.toContain("shell.150.willow");
  });

  it("lists each stand in under the line it covered", () => {
    const env = envWith();
    runCommand(commands, ["inventory", "autumn.pf", ...withBook], env);
    expect(env.stderr).toContain("short 1 of shell.150.palm");
    expect(env.stderr).toContain("1 cue as shell.150.willow from vn2");
    expect(env.stderr).toContain("short 1 of shell.75.peony");
  });

  it("does not call a stand in unused stock", () => {
    const env = envWith();
    runCommand(
      commands,
      ["inventory", "autumn.pf", ...withBook, "--unused"],
      env,
    );
    expect(env.stdout).toContain("every line in the magazine is used");
  });
});
