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
  "module 1 fc-32 at pad.a",
  "module 2 fc-32 at pad.b",
].join("\n");

const SHOW = [
  "show autumn",
  "frame 25",
  "at 20 fire shell.150 from pad.a label opener",
  "at 22 ripple 4 of shell.75 from pad.b every 200ms",
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

describe("check", () => {
  it("passes a clean show", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", "autumn.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("ready, 5 cues");
  });

  it("needs a script", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", ...base], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("name the script");
  });

  it("reports a script it cannot read", () => {
    const env = envWith();
    expect(runCommand(commands, ["check", "nothing.pf", ...base], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("cannot read the script");
  });

  it("reports a missing catalog", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", "--catalog", "gone.csv", "--rig", "autumn.rig"],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("cannot read the catalog");
  });

  it("fails a show with an unknown effect and names it", () => {
    const env = envWith({
      "bad.pf": "at 20 fire shell.999 from pad.a",
    });
    expect(runCommand(commands, ["check", "bad.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("shell.999");
  });

  it("stays quiet about detail when asked", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    runCommand(commands, ["check", "bad.pf", "--quiet", ...base], env);
    expect(env.stderr).not.toContain("shell.999");
    expect(env.stdout).toContain("not ready");
  });

  it("prints the numbers on request", () => {
    const env = envWith();
    runCommand(commands, ["check", "autumn.pf", "--stats", ...base], env);
    expect(env.stdout).toContain("cues        5");
    expect(env.stdout).toContain("drift");
    expect(env.stdout).toContain("density");
  });

  it("applies a density cap from the command line", () => {
    const env = envWith();
    runCommand(
      commands,
      ["check", "autumn.pf", "--max-lit", "1", ...base],
      env,
    );
    expect(env.stderr).toContain("PF3200");
  });

  it("applies a separation check when the audience line is given", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", "--audience", "40", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.stderr).toContain("PF4100");
  });

  it("passes the same show with room", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", "--audience", "200", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
  });

  it("takes a frame rate from the command line", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", "--frame", "30", ...base],
        env,
      ),
    ).toBe(EXIT_OK);
  });

  it("refuses a frame rate nothing runs at", () => {
    const env = envWith();
    expect(
      runCommand(
        commands,
        ["check", "autumn.pf", "--frame", "60", ...base],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
  });
});

describe("table", () => {
  it("writes a csv to standard output", () => {
    const env = envWith();
    expect(runCommand(commands, ["table", "autumn.pf", ...base], env)).toBe(
      EXIT_OK,
    );
    expect(env.stdout).toContain("cue,time,address");
    expect(env.stdout).toContain("shell.150");
  });

  it("writes to a file when told to", () => {
    const env = envWith();
    runCommand(
      commands,
      ["table", "autumn.pf", "--out", "table.csv", ...base],
      env,
    );
    expect(env.written.get("table.csv")).toContain("shell.150");
    expect(env.stdout).toContain("wrote 5 cues");
  });

  it("refuses to write from a show that did not compile", () => {
    const env = envWith({ "bad.pf": "at 20 fire shell.999 from pad.a" });
    expect(runCommand(commands, ["table", "bad.pf", ...base], env)).toBe(
      EXIT_SHOW_PROBLEM,
    );
    expect(env.stderr).toContain("refusing to write");
    expect(env.written.size).toBe(0);
  });

  it("writes anyway under force", () => {
    const env = envWith({
      "bad.pf": [
        "at 20 fire shell.999 from pad.a",
        "at 22 fire shell.150 from pad.a",
      ].join("\n"),
    });
    expect(
      runCommand(
        commands,
        ["table", "bad.pf", "--force", "--out", "t.csv", ...base],
        env,
      ),
    ).toBe(EXIT_SHOW_PROBLEM);
    expect(env.written.get("t.csv")).toContain("shell.150");
  });

  it("takes an address and a time style", () => {
    const env = envWith();
    runCommand(
      commands,
      [
        "table",
        "autumn.pf",
        "--address",
        "flat",
        "--time",
        "timecode",
        ...base,
      ],
      env,
    );
    expect(env.stdout).toContain("00:00:1");
  });

  it("refuses a flat address on a mixed rig", () => {
    const env = envWith({
      "mixed.rig": [
        "position pad.a at 0 0",
        "position pad.b at 40 0",
        "module 1 fc-32 at pad.a",
        "module 2 fc-16 at pad.b",
      ].join("\n"),
    });
    expect(
      runCommand(
        commands,
        [
          "table",
          "autumn.pf",
          "--address",
          "flat",
          "--catalog",
          "house.csv",
          "--rig",
          "mixed.rig",
        ],
        env,
      ),
    ).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("same pin count");
  });

  it("can leave the header out", () => {
    const env = envWith();
    runCommand(commands, ["table", "autumn.pf", "--no-header", ...base], env);
    expect(env.stdout).not.toContain("cue,time,address");
  });
});

describe("the command list", () => {
  it("holds check and table", () => {
    expect(commands.names()).toContain("check");
    expect(commands.names()).toContain("table");
  });
});

describe("the shared show pipeline", () => {
  const CATALOG_ONLY = [
    "id,kind,name,calibre",
    "shell.150,shell,six,150mm",
  ].join("\n");

  it("makes every show command report a missing rig the same way", () => {
    for (const name of ["check", "table", "sheet", "inventory", "preview"]) {
      const env = new MemoryEnv({
        "house.csv": CATALOG_ONLY,
        "autumn.pf": "at 20 fire shell.150 from pad.a",
      });
      const code = runCommand(
        commands,
        [name, "autumn.pf", "--catalog", "house.csv", "--rig", "gone.rig"],
        env,
      );
      expect(env.stderr).toContain("cannot read the rig sheet");
      expect(code).toBe(EXIT_SHOW_PROBLEM);
    }
  });

  it("makes every show command refuse a script it cannot read", () => {
    for (const name of ["check", "table", "sheet", "inventory", "preview"]) {
      const env = new MemoryEnv();
      expect(runCommand(commands, [name, "gone.pf"], env)).toBe(EXIT_BAD_USAGE);
      expect(env.stderr).toContain("cannot read the script");
    }
  });
});

describe("writing a document out", () => {
  const FILES = {
    "house.csv": ["id,kind,name,calibre", "shell.150,shell,six,150mm"].join(
      "\n",
    ),
    "autumn.rig": ["position pad.a at 0 0", "module 1 fc-32 at pad.a"].join(
      "\n",
    ),
    "autumn.pf": "at 20 fire shell.150 from pad.a",
  };
  const args = ["--catalog", "house.csv", "--rig", "autumn.rig"];

  it("trims the trailing newline the same way for every command", () => {
    for (const name of ["table", "sheet", "rehearse", "pack"]) {
      const env = new MemoryEnv(FILES);
      runCommand(commands, [name, "autumn.pf", ...args], env);
      expect(env.stdout.endsWith("\n")).toBe(false);
    }
  });

  it("writes to a file and says so the same way", () => {
    for (const name of ["table", "sheet", "rehearse", "pack"]) {
      const env = new MemoryEnv(FILES);
      runCommand(
        commands,
        [name, "autumn.pf", "--out", `${name}.txt`, ...args],
        env,
      );
      expect(env.written.has(`${name}.txt`)).toBe(true);
      expect(env.stdout).toContain(`to ${name}.txt`);
    }
  });

  it("reports a failed write on standard error, not standard output", () => {
    class ReadOnly extends MemoryEnv {
      override writeFile(): boolean {
        return false;
      }
    }
    for (const name of ["table", "sheet", "rehearse", "pack"]) {
      const env = new ReadOnly(FILES);
      const code = runCommand(
        commands,
        [name, "autumn.pf", "--out", "x.txt", ...args],
        env,
      );
      expect(code).toBe(EXIT_SHOW_PROBLEM);
      expect(env.stderr).toContain("cannot write to x.txt");
      expect(env.stdout).not.toContain("cannot write");
    }
  });
});

describe("the advice flag", () => {
  it("adds the judgement checks to check", () => {
    const env = envWith();
    runCommand(commands, ["check", "autumn.pf", "--advice", ...base], env);
    expect(env.stderr).toContain("PF3500");
  });

  it("leaves them out without the flag", () => {
    const env = envWith();
    runCommand(commands, ["check", "autumn.pf", ...base], env);
    expect(env.stderr).not.toContain("PF3500");
  });

  it("does not change the verdict", () => {
    const plain = envWith();
    const advised = envWith();
    const one = runCommand(commands, ["check", "autumn.pf", ...base], plain);
    const two = runCommand(
      commands,
      ["check", "autumn.pf", "--advice", ...base],
      advised,
    );
    expect(one).toBe(two);
  });
});
