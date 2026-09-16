import { describe, expect, it } from "vitest";
import { ExitCode } from "./exit-codes.js";
import { parseArgs, UsageError } from "./options.js";
import { runCommand } from "./router.js";

describe("CLI options and exit codes", () => {
  it("parses --root and --format", () => {
    const parsed = parseArgs(["describe", "--root", "capsule", "--format", "json"]);
    expect(parsed.options.root).toBe("capsule");
    expect(parsed.options.format).toBe("json");
    expect(parsed.command).toEqual(["describe"]);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseArgs(["--weather"])).toThrow(UsageError);
  });

  it("returns exit 5 when no command is given", () => {
    expect(runCommand([]).exitCode).toBe(ExitCode.INVALID_INVOCATION);
  });

  it("prints help without failing", () => {
    const result = runCommand(["help"]);
    expect(result.exitCode).toBe(ExitCode.OK);
    expect(result.stdout).toContain("biomeweaver");
  });
});
