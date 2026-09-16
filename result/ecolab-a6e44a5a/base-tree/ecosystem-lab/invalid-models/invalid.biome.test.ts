import { describe, expect, it } from "vitest";
import { runCommand } from "@biomeweaver/cli";
import { invalidModel } from "../helpers/paths.js";

describe("invalid models", () => {
  it("exits 3 when a predator names missing prey", () => {
    const result = runCommand(["check", "--root", invalidModel("unknown-prey")]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toMatch(/unknown species|missing-hare|BW-ID-006/);
  });

  it("exits 3 when an initial count is negative", () => {
    const result = runCommand(["check", "--root", invalidModel("negative-count")]);
    expect(result.exitCode).toBe(3);
  });
});
