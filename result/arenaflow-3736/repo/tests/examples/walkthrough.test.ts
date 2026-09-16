import { describe, expect, it } from "vitest";
import { runWeekendCupWalkthrough } from "../../src/examples/walkthrough.js";

describe("weekend cup walkthrough", () => {
  it("produces a deterministic report", () => {
    const first = runWeekendCupWalkthrough();
    const second = runWeekendCupWalkthrough();
    expect(first).toBe(second);
    expect(first).toContain("Weekend Cup");
    expect(first).toContain("events=");
  });
});
