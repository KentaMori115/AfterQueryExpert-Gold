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

/**
 * The magazine flags, which every show reading command shares.
 *
 * A crew that checked a show against the book and then printed a sheet from the
 * catalog would carry the wrong paper onto the field, so the flags live on all
 * of the show commands rather than on `inventory` alone.
 */
describe("firing a show out of the magazine", () => {
  const HOUSE = [
    "id,kind,name,calibre,break,hang,diameter",
    "shell.150.palm,shell,six inch palm,150mm,palm,2.4,140",
    "shell.150.kamuro,shell,six inch kamuro,150mm,kamuro,2.4,138",
    "shell.75,shell,three inch,75mm,peony,1.8,60",
  ].join("\n");

  const PALMS = [
    "show autumn",
    "at 20 fire shell.150.palm from pad.a label one",
    "at 30 fire shell.150.palm from pad.a label two",
  ].join("\n");

  const STOCK = [
    "lot,effect,quantity,received",
    "vn2405,shell.150.palm,1,2025-04-05",
    "vn2413,shell.150.palm,1,2025-04-13",
    "vn2500,shell.150.kamuro,4,2025-01-01",
  ].join("\n");

  function magazineEnv(over: Record<string, string> = {}): MemoryEnv {
    return new MemoryEnv({
      "house.csv": HOUSE,
      "autumn.rig": RIG,
      "palms.pf": PALMS,
      "stock.csv": STOCK,
      ...over,
    });
  }

  const drawn = [
    "--catalog",
    "house.csv",
    "--rig",
    "autumn.rig",
    "--magazine",
    "stock.csv",
  ];

  it("checks a show that the book can supply", () => {
    const env = magazineEnv();
    expect(runCommand(commands, ["check", "palms.pf", ...drawn], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("ready");
  });

  it("puts the lot on the cue sheet", () => {
    const env = magazineEnv();
    runCommand(commands, ["sheet", "palms.pf", ...drawn], env);
    expect(env.stdout).toContain("lot");
    expect(env.stdout).toContain("vn2405");
    expect(env.stdout).toContain("vn2413");
  });

  it("leaves the lot column off a sheet drawn from the catalog", () => {
    const env = magazineEnv();
    runCommand(
      commands,
      ["sheet", "palms.pf", "--catalog", "house.csv", "--rig", "autumn.rig"],
      env,
    );
    expect(env.stdout).not.toContain("vn2405");
  });

  it("sets a lot aside on request and draws round it", () => {
    const env = magazineEnv();
    runCommand(
      commands,
      ["sheet", "palms.pf", "--pull", "VN2405", ...drawn],
      env,
    );
    expect(env.stdout).not.toContain("vn2405");
    expect(env.stdout).toContain("vn2413");
    expect(env.stdout).toContain("vn2500");
  });

  it("notes the stand in a shortfall drew", () => {
    const env = magazineEnv({
      "thin.csv": ["lot,effect,quantity", "vn2500,shell.150.kamuro,4"].join(
        "\n",
      ),
    });
    expect(
      runCommand(
        commands,
        ["check", "palms.pf", "--magazine", "thin.csv", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1601");
    expect(env.stderr).toContain("shell.150.palm short 2");
  });

  it("will not call a show ready when the store cannot cover it", () => {
    const env = magazineEnv({
      "empty.csv": ["lot,effect,quantity", "vn9,shell.75,4"].join("\n"),
    });
    expect(
      runCommand(
        commands,
        ["check", "palms.pf", "--magazine", "empty.csv", ...base],
        env,
      ),
    ).not.toBe(EXIT_OK);
    expect(env.stderr).toContain("PF1600");
  });

  it("reports a magazine book it cannot read from any command", () => {
    const env = magazineEnv();
    expect(
      runCommand(
        commands,
        ["check", "palms.pf", "--magazine", "gone.csv", ...base],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("cannot read the magazine book");
  });

  it("still writes a firing table from a drawn show", () => {
    const env = magazineEnv();
    expect(runCommand(commands, ["table", "palms.pf", ...drawn], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("shell.150.palm");
  });

  it("counts what the script asked for, not what it drew", () => {
    const env = magazineEnv({
      "thin.csv": ["lot,effect,quantity", "vn2500,shell.150.kamuro,4"].join(
        "\n",
      ),
    });
    runCommand(
      commands,
      ["inventory", "palms.pf", "--magazine", "thin.csv", ...base],
      env,
    );
    const line = env.stdout
      .split("\n")
      .find((row) => row.startsWith("shell.150.palm"));
    expect(line?.trim().split(/\s+/)).toEqual([
      "shell.150.palm",
      "2",
      "0",
      "2",
    ]);
    expect(env.stdout).toContain("drawing shell.150.kamuro from vn2500");
  });
});

describe("pulling a lot with no book to pull it from", () => {
  it("says so rather than quietly ignoring the flag", () => {
    const env = envWith();
    runCommand(commands, ["check", "autumn.pf", "--pull", "vn1", ...base], env);
    expect(env.stderr).toContain("--pull needs a --magazine");
  });
});
