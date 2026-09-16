import { describe, expect, it } from "vitest";
import { allocateResource, type DemandRow } from "./allocate.js";

function row(
  partial: Partial<DemandRow> & Pick<DemandRow, "key" | "requested" | "priority">,
): DemandRow {
  return {
    species: "snow-hare",
    stage: "adult",
    region: "northern-basin",
    resource: "silver-grass-biomass",
    ...partial,
  };
}

describe("resource allocation", () => {
  it("satisfies higher priority demand first", () => {
    const allocated = allocateResource(
      [
        row({ key: "hare", priority: 20, requested: 8n }),
        row({ key: "beetle", priority: 10, requested: 8n, species: "dune-beetle" }),
      ],
      10n,
    );
    expect(allocated.find((item) => item.key === "hare")?.allocated).toBe(8n);
    expect(allocated.find((item) => item.key === "beetle")?.allocated).toBe(2n);
  });

  it("splits equal priority proportionally and assigns leftover by key order", () => {
    const allocated = allocateResource(
      [
        row({ key: "b", priority: 5, requested: 5n }),
        row({ key: "a", priority: 5, requested: 5n }),
      ],
      5n,
    );
    expect(allocated.find((item) => item.key === "a")?.allocated).toBe(3n);
    expect(allocated.find((item) => item.key === "b")?.allocated).toBe(2n);
  });

  it("never allocates more than the available quantity", () => {
    const allocated = allocateResource([row({ key: "hare", priority: 1, requested: 40n })], 7n);
    expect(allocated[0]?.allocated).toBe(7n);
  });
});
