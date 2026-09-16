import { describe, expect, it } from "vitest";
import type { AttributedFlow } from "@biomeweaver/flow-explanations";
import { renderCsvReport, renderJsonReport, renderMarkdownReport } from "./render.js";

const flows: AttributedFlow[] = [
  {
    tick: 31,
    kind: "population-decrease",
    species: "snow-hare",
    stage: "adult",
    region: "northern-basin",
    quantity: "7.250000",
    cause: "resource-deficit-mortality",
    rule: "snow-hare.needs.silver-grass-biomass",
  },
];

describe("reports", () => {
  it("renders JSON without a trailing timestamp field", () => {
    const text = renderJsonReport([], flows);
    expect(text).toContain("resource-deficit-mortality");
    expect(text).not.toContain("generatedAt");
  });

  it("renders CSV with a stable header", () => {
    const text = renderCsvReport(flows);
    expect(text.startsWith("tick,kind,species,")).toBe(true);
    expect(text).toContain("7.250000");
  });

  it("renders Markdown cause counts", () => {
    const text = renderMarkdownReport("Crystal Tundra", [], flows);
    expect(text).toContain("# Crystal Tundra");
    expect(text).toContain("resource-deficit-mortality: 1");
  });
});
