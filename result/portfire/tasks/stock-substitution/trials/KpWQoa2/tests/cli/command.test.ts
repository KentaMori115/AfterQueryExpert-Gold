import { describe, expect, it } from "vitest";
import {
  CommandSet,
  EXIT_BAD_USAGE,
  EXIT_OK,
  EXIT_SHOW_PROBLEM,
  commandHelp,
  overallHelp,
  reportDiagnostics,
  runCommand,
} from "../../src/cli/command.js";
import type { Command } from "../../src/cli/command.js";
import { MemoryEnv, loadWorkspace } from "../../src/cli/env.js";
import { DiagnosticBag } from "../../src/core/diagnostic.js";

const echo: Command = {
  name: "echo",
  summary: "say the arguments back",
  usage: "echo <words>",
  flags: [{ name: "loud", kind: "switch", help: "shout" }],
  run(args, env) {
    const text = args.positional.join(" ");
    env.out(args.switches.has("loud") ? text.toUpperCase() : text);
    return EXIT_OK;
  },
};

const failing: Command = {
  name: "fail",
  summary: "always fails",
  usage: "fail",
  flags: [],
  run(_args, env) {
    env.err("it failed");
    return EXIT_SHOW_PROBLEM;
  },
};

const commands = new CommandSet().add(echo).add(failing);

describe("CommandSet", () => {
  it("finds a command by name", () => {
    expect(commands.get("echo")).toBe(echo);
    expect(commands.get("nothing")).toBeUndefined();
  });

  it("lists names in order", () => {
    expect(commands.names()).toEqual(["echo", "fail"]);
  });

  it("replaces a command with the same name", () => {
    const set = new CommandSet().add(echo).add({ ...echo, summary: "new" });
    expect(set.all()).toHaveLength(1);
    expect(set.get("echo")?.summary).toBe("new");
  });
});

describe("help", () => {
  it("lists every command", () => {
    const help = overallHelp(commands);
    expect(help).toContain("echo");
    expect(help).toContain("say the arguments back");
  });

  it("shows the usage and flags of one command", () => {
    const help = commandHelp(echo);
    expect(help).toContain("usage: portfire echo <words>");
    expect(help).toContain("--loud");
  });

  it("leaves the options block out for a command with no flags", () => {
    expect(commandHelp(failing)).not.toContain("options:");
  });
});

describe("runCommand", () => {
  it("runs a command and gives back its code", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["echo", "hello"], env)).toBe(EXIT_OK);
    expect(env.stdout).toBe("hello");
  });

  it("passes flags through", () => {
    const env = new MemoryEnv();
    runCommand(commands, ["echo", "--loud", "hello"], env);
    expect(env.stdout).toBe("HELLO");
  });

  it("returns the command's own failure code", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["fail"], env)).toBe(EXIT_SHOW_PROBLEM);
  });

  it("prints help and fails when given nothing", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, [], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stdout).toContain("commands:");
  });

  it("prints help and succeeds when asked for it", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["help"], env)).toBe(EXIT_OK);
    expect(runCommand(commands, ["--help"], env)).toBe(EXIT_OK);
  });

  it("prints help for one command", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["help", "echo"], env)).toBe(EXIT_OK);
    expect(env.stdout).toContain("portfire echo <words>");
  });

  it("refuses help for a command that is not there", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["help", "nothing"], env)).toBe(EXIT_BAD_USAGE);
  });

  it("names the commands when the first word is not one", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["nonsense"], env)).toBe(EXIT_BAD_USAGE);
    expect(env.stderr).toContain("echo, fail");
  });

  it("separates a bad flag from a failing show", () => {
    const env = new MemoryEnv();
    expect(runCommand(commands, ["echo", "--nonsense"], env)).toBe(
      EXIT_BAD_USAGE,
    );
    expect(env.stderr).toContain("unknown flag");
  });
});

describe("reportDiagnostics", () => {
  it("says nothing and succeeds for an empty bag", () => {
    const env = new MemoryEnv();
    expect(reportDiagnostics(new DiagnosticBag(), env)).toBe(EXIT_OK);
    expect(env.stderr).toBe("");
  });

  it("prints warnings and still succeeds", () => {
    const env = new MemoryEnv();
    const bag = new DiagnosticBag().warning({ code: "A", message: "careful" });
    expect(reportDiagnostics(bag, env)).toBe(EXIT_OK);
    expect(env.stderr).toContain("careful");
  });

  it("fails when there is an error", () => {
    const env = new MemoryEnv();
    const bag = new DiagnosticBag().error({ code: "A", message: "no" });
    expect(reportDiagnostics(bag, env)).toBe(EXIT_SHOW_PROBLEM);
  });
});

describe("MemoryEnv", () => {
  it("reads the files it was given", () => {
    const env = new MemoryEnv({ "show.pf": "at 1 fire a from b" });
    expect(env.readFile("show.pf")).toContain("fire");
    expect(env.readFile("nothing.pf")).toBeUndefined();
  });

  it("reads back what it wrote", () => {
    const env = new MemoryEnv();
    env.writeFile("out.csv", "cue,time");
    expect(env.readFile("out.csv")).toBe("cue,time");
  });
});

describe("loadWorkspace", () => {
  const catalogCsv = ["id,kind,name,calibre", "shell.150,shell,six,150mm"].join(
    "\n",
  );
  const rigSheet = ["position pad.a at 0 0", "module 1 fc-32 at pad.a"].join(
    "\n",
  );

  it("loads both files", () => {
    const env = new MemoryEnv({ "house.csv": catalogCsv, "a.rig": rigSheet });
    const workspace = loadWorkspace(env, {
      catalog: "house.csv",
      rig: "a.rig",
    });
    expect(workspace.catalog.size).toBe(1);
    expect(workspace.rig.moduleCount).toBe(1);
    expect(workspace.diagnostics.size).toBe(0);
  });

  it("reports a missing catalog and a missing rig separately", () => {
    const env = new MemoryEnv();
    const workspace = loadWorkspace(env, {
      catalog: "missing.csv",
      rig: "missing.rig",
    });
    expect(workspace.diagnostics.byCode("PF5000")).toHaveLength(1);
    expect(workspace.diagnostics.byCode("PF5001")).toHaveLength(1);
  });

  it("gives an empty catalog and rig when neither was asked for", () => {
    const workspace = loadWorkspace(new MemoryEnv(), {});
    expect(workspace.catalog.size).toBe(0);
    expect(workspace.rig.moduleCount).toBe(0);
    expect(workspace.diagnostics.size).toBe(0);
  });

  it("falls back to the default rig settings", () => {
    const workspace = loadWorkspace(new MemoryEnv(), {});
    expect(workspace.settings.voltage).toBe(24);
    expect(workspace.settings.match.name).toBe("standard");
  });

  it("passes a parse problem through", () => {
    const env = new MemoryEnv({ "a.rig": "rocket 4" });
    const workspace = loadWorkspace(env, { rig: "a.rig" });
    expect(workspace.diagnostics.byCode("PF1211")).toHaveLength(1);
  });
});
