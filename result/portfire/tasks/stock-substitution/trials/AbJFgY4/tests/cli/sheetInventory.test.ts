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
  "shell.150,shell,six inch palm,150mm,palm,2.4,140",
  "shell.75,shell,three inch,75mm,peony,1.8,60",
].join("\n");

const RIG = [
  "position pad.a at 0 0",
  "position pad.b at 40 0",
  "module 1 fc-16 at pad.a",
  "module 2 fc-16 at pad.b",
].join("\n");

const SHOW = [
  "show autumn",
  "at 20 fire shell.150 from pad.a label opener",
  "at 22 ripple 4 of shell.75 from pad.b every 200ms",
].join("\n");

const BOOK = [
  "lot,effect,quantity,received,note",
  "vn1,shell.150,4,2025-04-02,",
  "vn2,shell.75,2,2025-04-02,",
  "vn3,mine.100,10,2025-04-02,",
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

describe("sheet", () => {
  it("prints a cue sheet with a header block", () => {
    const env = envWith();
    expect(runCommand(commands, ["sheet", "autumn.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("5 cues");
    expect(env.stdout).toContain("6in palm");
  });

  it("can leave the header out", () => {
    const env = envWith();
    runCommand(commands, ["sheet", "autumn.pf", "--no-header", ...base], env);
    expect(env.stdout).not.toContain("5 cues");
  });

  it("prints a wiring sheet with every pin", () => {
    const env = envWith();
    runCommand(
      commands,
      ["sheet", "autumn.pf", "--kind", "wiring", ...base],
      env,
    );
    expect(env.stdout).toContain("module 1 (fc-16)");
    expect(env.stdout).toContain("01.16");
  });

  it("prints one block per position", () => {
    const env = envWith();
    runCommand(
      commands,
      ["sheet", "autumn.pf", "--kind", "position", ...base],
      env,
    );
    expect(env.stdout).toContain("pad.a");
    expect(env.stdout).toContain("pad.b");
  });

  it("says so when a position sheet has nothing on it", () => {
    const env = envWith({ "empty.pf": "show quiet" });
    runCommand(
      commands,
      ["sheet", "empty.pf", "--kind", "position", ...base],
      env,
    );
    expect(env.stdout).toContain("no position sheets");
  });

  it("writes to a file", () => {
    const env = envWith();
    runCommand(
      commands,
      ["sheet", "autumn.pf", "--out", "cues.txt", ...base],
      env,
    );
    expect(env.written.get("cues.txt")).toContain("6in palm");
    expect(env.stdout).toContain("wrote the cue sheet");
  });

  it("still prints a sheet from a show with errors", () => {
    const env = envWith({
      "bad.pf": [
        "at 20 fire shell.999 from pad.a",
        "at 22 fire shell.150 from pad.a",
      ].join("\n"),
    });
    expect(runCommand(commands, ["sheet", "bad.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stdout).toContain("6in palm");
    expect(env.stderr).toContain("shell.999");
  });

  it("can drop the break column", () => {
    const env = envWith();
    runCommand(commands, ["sheet", "autumn.pf", "--no-break", ...base], env);
    expect(env.stdout).not.toContain("break");
  });
});

describe("inventory", () => {
  it("counts what the show consumes without a book", () => {
    const env = envWith();
    expect(runCommand(commands, ["inventory", "autumn.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("shell.75");
    expect(env.stdout).toContain("shell.150");
  });

  it("compares against the magazine and finds the shortfall", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["inventory", "autumn.pf", "--magazine", "book.csv", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("short 2 of shell.75");
  });

  it("says so when everything is in stock", () => {
    const env = envWith({
      "plenty.csv": [
        "lot,effect,quantity",
        "vn1,shell.150,40",
        "vn2,shell.75,40",
      ].join("\n"),
    });
    expect(
      runCommand(
        commands,
        ["inventory", "autumn.pf", "--magazine", "plenty.csv", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stdout).toContain("everything on the shot list is in stock");
  });

  it("lists stock the show never touches on request", () => {
    const env = envWith();
    runCommand(
      commands,
      ["inventory", "autumn.pf", "--magazine", "book.csv", "--unused", ...base],
      env,
    );
    expect(env.stdout).toContain("not used by this show: mine.100");
  });

  it("reports a magazine book it cannot read", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["inventory", "autumn.pf", "--magazine", "gone.csv", ...base],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("cannot read the magazine book");
  });

  it("stops on a magazine book that will not parse", () => {
    const env = envWith({ "broken.csv": "lot,effect\nvn1,shell.150" });
    expect(
      runCommand(
        commands,
        ["inventory", "autumn.pf", "--magazine", "broken.csv", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1301");
  });

  it("leaves the on hand column empty with no book", () => {
    const env = envWith();
    runCommand(commands, ["inventory", "autumn.pf", ...base], env);
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.75"));
    expect(line?.trim().split(/\s+/)).toEqual(["shell.75", "4"]);
  });
});

describe("the command list", () => {
  it("holds the commands a show needs end to end", () => {
    for (const name of ["check", "sheet", "table", "inventory"]) {
      expect(commands.names()).toContain(name);
    }
  });

  it("gives every command a name, a summary and a usage line", () => {
    for (const command of commands.all()) {
      expect(command.name).toMatch(/^[a-z][a-z-]*$/);
      expect(command.summary.length).toBeGreaterThan(10);
      expect(command.usage.startsWith(command.name)).toBe(true);
    }
  });

  it("names every command in the overall help", () => {
    const env = new MemoryEnv();
    runCommand(commands, ["help"], env);
    for (const name of commands.names()) {
      expect(env.stdout).toContain(name);
    }
  });

  it("gives every command its own help screen", () => {
    for (const name of commands.names()) {
      const env = new MemoryEnv();
      expect(runCommand(commands, ["help", name], env)).toBe(EXIT_OK);
      expect(env.stdout).toContain(`usage: portfire ${name}`);
    }
  });
});

describe("firing a show from the magazine", () => {
  const HOUSE = [
    "id,kind,name,calibre,break,hang,diameter",
    "shell.150.palm,shell,six inch palm,150mm,palm,2.4,140",
    "shell.150.kamuro,shell,six inch kamuro,150mm,kamuro,2.4,140",
  ].join("\n");

  const SHOW3 = [
    "show autumn",
    "at 20 fire shell.150.palm from pad.a",
    "at 24 fire shell.150.palm from pad.a",
    "at 28 fire shell.150.palm from pad.a",
  ].join("\n");

  const SHORT = [
    "lot,effect,quantity,received",
    "vn1,shell.150.palm,1,2025-04-02",
    "kk,shell.150.kamuro,4,2025-04-02",
  ].join("\n");

  function stockEnv(over: Record<string, string> = {}): MemoryEnv {
    return new MemoryEnv({
      "house.csv": HOUSE,
      "autumn.rig": RIG,
      "three.pf": SHOW3,
      "book.csv": SHORT,
      ...over,
    });
  }

  it("draws the stand ins and notes them on a check", () => {
    const env = stockEnv();
    expect(
      runCommand(
        commands,
        ["check", "three.pf", "--magazine", "book.csv", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("firing shell.150.kamuro");
  });

  it("puts the lot each cue drew on the cue sheet", () => {
    const env = stockEnv();
    runCommand(
      commands,
      ["sheet", "three.pf", "--magazine", "book.csv", ...base],
      env,
    );
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn1");
    expect(env.stdout).toContain("kk");
  });

  it("leaves the lot column off a sheet with no book", () => {
    const env = stockEnv();
    runCommand(commands, ["sheet", "three.pf", ...base], env);
    expect(env.stdout).not.toContain("lot");
  });

  it("sets a lot aside when told to pull it", () => {
    const env = stockEnv();
    expect(
      runCommand(
        commands,
        [
          "check",
          "three.pf",
          "--magazine",
          "book.csv",
          "--pull",
          "VN1",
          ...base,
        ],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("short 3 shots");
  });

  it("warns about a pulled lot the book does not hold", () => {
    const env = stockEnv();
    runCommand(
      commands,
      ["check", "three.pf", "--magazine", "book.csv", "--pull", "vn9", ...base],
      env,
    );
    expect(env.stderr).toContain("PF1603");
  });

  it("refuses a pull with no book to pull from", () => {
    const env = stockEnv();
    expect(
      runCommand(
        commands,
        ["check", "three.pf", "--pull", "vn1", ...base],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("needs --magazine");
  });

  it("fails a show a stand in cannot cover", () => {
    const env = stockEnv({
      "empty.csv": ["lot,effect,quantity", "kk,shell.150.kamuro,0"].join("\n"),
    });
    expect(
      runCommand(
        commands,
        ["check", "three.pf", "--magazine", "empty.csv", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1600");
  });

  it("still counts the order list against what the script asked for", () => {
    const env = stockEnv();
    expect(
      runCommand(
        commands,
        ["inventory", "three.pf", "--magazine", "book.csv", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.150.palm"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.150.palm",
      "3",
      "1",
      "2",
    ]);
    expect(env.stdout).not.toContain("shell.150.kamuro  ");
  });

  it("lists each stand in under the line it covers", () => {
    const env = stockEnv();
    runCommand(
      commands,
      ["inventory", "three.pf", "--magazine", "book.csv", ...base],
      env,
    );
    expect(env.stderr).toContain("short 2 of shell.150.palm");
    expect(env.stderr).toContain(
      "2 shots drawn as shell.150.kamuro from lot kk",
    );
  });
});
