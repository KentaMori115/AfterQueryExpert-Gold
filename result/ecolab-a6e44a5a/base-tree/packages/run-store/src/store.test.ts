import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDigest, verifyRun, writeRun } from "./store.js";

describe("run store", () => {
  it("writes a manifest digest that verify can confirm", () => {
    const root = mkdtempSync(join(tmpdir(), "bw-run-"));
    const flows = [
      {
        tick: 0,
        kind: "initial-state" as const,
        region: "northern-basin",
        quantity: "850.000000",
        cause: "initial-state",
        rule: "scenario.baseline",
      },
    ];
    const digest = runDigest("baseline", "abc", 1, flows);
    writeRun(root, {
      manifest: { runId: "run1", scenario: "baseline", fingerprint: "abc", ticks: 1, digest },
      states: [{ tick: 0, season: "winter", cohorts: [], pools: [], flows: [], alerts: [] }],
      flows,
    });
    expect(verifyRun(root, "run1").ok).toBe(true);
  });
});
