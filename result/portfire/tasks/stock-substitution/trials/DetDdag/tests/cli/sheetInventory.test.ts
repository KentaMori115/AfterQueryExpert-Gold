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

describe("a show drawn from the magazine", () => {
  const CATALOG = [
    "id,kind,name,calibre,break,hang,diameter",
    "shell.150.palm,shell,six palm,150mm,palm,2.4,140",
    "shell.150.aster,shell,six aster,150mm,peony,2.4,140",
  ].join("\n");
  const SHOW = [
    "show autumn",
    "at 20 fire shell.150.palm from pad.a label one",
    "at 24 fire shell.150.palm from pad.a label two",
  ].join("\n");
  const BOOK = [
    "lot,effect,quantity,received",
    "vn2413,shell.150.palm,1,2025-06-02",
    "vn2405,shell.150.palm,1,2025-04-02",
    "vn9000,shell.150.aster,4,2025-01-02",
  ].join("\n");

  function drawEnv(over: Record<string, string> = {}): MemoryEnv {
    return new MemoryEnv({
      "house.csv": CATALOG,
      "autumn.rig": RIG,
      "autumn.pf": SHOW,
      "book.csv": BOOK,
      ...over,
    });
  }

  const drawn = [
    "--catalog",
    "house.csv",
    "--rig",
    "autumn.rig",
    "--magazine",
    "book.csv",
  ];

  it("puts a lot column on the cue sheet once there is a book", () => {
    const env = drawEnv();
    runCommand(commands, ["sheet", "autumn.pf", "--no-header", ...drawn], env);
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn2405");
    expect(env.stdout).toContain("vn2413");
  });

  it("leaves the lot column off a sheet with no book", () => {
    const env = drawEnv();
    runCommand(
      commands,
      [
        "sheet",
        "autumn.pf",
        "--no-header",
        "--catalog",
        "house.csv",
        "--rig",
        "autumn.rig",
      ],
      env,
    );
    expect(env.stdout).not.toContain("lot");
  });

  it("empties the oldest lot first", () => {
    const env = drawEnv();
    runCommand(commands, ["sheet", "autumn.pf", "--no-header", ...drawn], env);
    const rows = env.stdout.split("\n").filter((row) => row.includes("vn24"));
    expect(rows[0]).toContain("vn2405");
    expect(rows[1]).toContain("vn2413");
  });

  it("stands something else in and says so", () => {
    const env = drawEnv();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", ...drawn, "--pull", "VN2413"],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("shell.150.aster");
  });

  it("fails when a lot is pulled and nothing can cover the cue", () => {
    const env = drawEnv({
      "thin.csv": ["lot,effect,quantity", "vn2405,shell.150.palm,2"].join("\n"),
    });
    expect(
      runCommand(
        commands,
        [
          "check",
          "autumn.pf",
          ...drawn.slice(0, 4),
          "--magazine",
          "thin.csv",
          "--pull",
          "vn2405",
        ],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF1600");
  });

  it("says a pull needs a book to pull from", () => {
    const env = drawEnv();
    runCommand(
      commands,
      [
        "check",
        "autumn.pf",
        "--catalog",
        "house.csv",
        "--rig",
        "autumn.rig",
        "--pull",
        "vn2405",
      ],
      env,
    );
    expect(env.stderr).toContain("--pull has nothing to pull from");
  });

  it("names the lot and the asked-for effect when explaining a covered cue", () => {
    const env = drawEnv();
    runCommand(
      commands,
      ["explain", "autumn.pf", "one", ...drawn, "--pull", "vn2405,vn2413"],
      env,
    );
    expect(env.stdout).toContain("standing in for  shell.150.palm");
    expect(env.stdout).toContain("lot              vn9000");
  });

  it("still orders what the script asked for, whatever stood in", () => {
    const env = drawEnv();
    expect(
      runCommand(
        commands,
        ["inventory", "autumn.pf", ...drawn, "--pull", "vn2413"],
        env,
      ),
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
    expect(env.stderr).toContain("short 1 of shell.150.palm");
  });

  it("lists each stand-in under the line it covers, with its lots", () => {
    const env = drawEnv();
    runCommand(
      commands,
      ["inventory", "autumn.pf", ...drawn, "--pull", "vn2413"],
      env,
    );
    const line = env.stdout
      .split("\n")
      .find((row) => row.includes("stood in by"));
    expect(line).toContain("shell.150.aster");
    expect(line).toContain("vn9000");
    expect(line).toContain("1");
  });

  it("does not call stock a stand-in came out of unused", () => {
    const env = drawEnv();
    runCommand(
      commands,
      ["inventory", "autumn.pf", ...drawn, "--pull", "vn2413", "--unused"],
      env,
    );
    expect(env.stdout).toContain("every line in the magazine is used");
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
