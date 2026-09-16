import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import { availableCommands } from "../../src/cli/commands/index.js";

const T0 = "1700002100000";

describe("cli", () => {
  it("prints help and version", async () => {
    let help = "";
    const helpCode = await runCli(["help"], (text) => {
      help += text;
    });
    expect(helpCode).toBe(0);
    expect(help).toContain("arenaflow");
    let version = "";
    const versionCode = await runCli(["version"], (text) => {
      version += text;
    });
    expect(versionCode).toBe(0);
    expect(version).toContain("1.0.0");
    expect(availableCommands()).toContain("match:result");
  });

  it("runs a tournament workflow", async () => {
    const outputs: string[] = [];
    const write = (text: string) => outputs.push(text);
    await runCli(["player:create", "--id", "plr_a", "--name", "Ann", "--at", T0], write);
    await runCli(["player:create", "--id", "plr_b", "--name", "Ben", "--at", T0], write);
    await runCli(["tournament:create", "--id", "tnm_cup", "--name", "Cup", "--at", T0], write);
    const unknown = await runCli(["nope"], write);
    expect(unknown).toBe(1);
  });
});
