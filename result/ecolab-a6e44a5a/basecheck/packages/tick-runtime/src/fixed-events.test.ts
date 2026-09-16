import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { simulate } from "@biomeweaver/tick-runtime";

const MANIFEST = `biome: flats
displayName: Flats
calendar: flat-year
defaultScenario: baseline
include:
  regions: regions/*.yaml
  habitats: habitats/*.yaml
  resources: resources/*.yaml
  calendars: calendars/*.yaml
  scenarios: scenarios/*.yaml
  events: events/*.yaml
precision:
  scale: 1000000
  rounding: half-even
`;

const BASE: Readonly<Record<string, string>> = {
  "regions/east.yaml": "kind: region\nid: east\nname: East\n",
  "regions/north.yaml": "kind: region\nid: north\nname: North\n",
  "regions/west.yaml": "kind: region\nid: west\nname: West\n",
  "habitats/north-flat.yaml":
    "kind: habitat\nid: north-flat\nregion: north\ncapacity: {}\nmodifiers:\n  dry:\n    moss-growth: 0.5\n",
  "resources/salt.yaml":
    "kind: resource\nid: salt\nname: Salt\nrenewable: false\nrenewalPerTick: 0\n",
  "resources/moss.yaml":
    "kind: resource\nid: moss\nname: Moss\nrenewable: true\nrenewalPerTick: 100\n",
  "calendars/flat-year.yaml":
    "kind: calendar\nid: flat-year\nseasons:\n  - id: dry\n    startTick: 0\n    endTick: 9\n",
};

function writeCapsule(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "bw-disturbance-"));
  writeFileSync(join(root, "biomeweaver.yaml"), MANIFEST);
  for (const [path, text] of Object.entries({ ...BASE, ...files })) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

function scenario(pools: string, hooks: string, ticks = 6): string {
  return `kind: scenario\nid: baseline\ndurationTicks: ${ticks}\ninitialPopulations: []\ninitialResources:\n${pools}events:\n${hooks}`;
}

function pool(resource: string, region: string, quantity: string): string {
  return `  - resource: ${resource}\n    region: ${region}\n    quantity: ${quantity}\n`;
}

function hook(atTick: number, event: string): string {
  return `  - atTick: ${atTick}\n    event: ${event}\n`;
}

function run(files: Readonly<Record<string, string>>, ticks: number) {
  const compiled = compileCapsule({ root: writeCapsule(files) });
  const model = compiled.model;
  if (!model) {
    throw new Error(compiled.diagnostics.map((item) => item.message).join("; "));
  }
  const chosen = model.scenarios["baseline"];
  if (!chosen) {
    throw new Error("the capsule has no baseline scenario");
  }
  return simulate(model, chosen, ticks);
}

function held(
  result: ReturnType<typeof run>,
  tick: number,
  resource: string,
  region: string,
): bigint {
  const state = result.states[tick];
  const found = state?.pools.find((item) => item.resource === resource && item.region === region);
  return found?.quantity ?? -1n;
}

function disturbanceFlows(result: ReturnType<typeof run>, tick: number) {
  return result.flows.filter((flow) => flow.cause === "fixed-event" && flow.tick === tick);
}

const THIRDS = pool("salt", "east", "1") + pool("salt", "north", "1") + pool("salt", "west", "1");

describe("fixed disturbances", () => {
  it("splits a withdrawal in proportion to what each pool holds", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -6\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "2") + pool("salt", "north", "10"),
          hook(1, "drain"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(1_000_000n);
    expect(held(result, 1, "salt", "north")).toBe(5_000_000n);
  });

  it("hands a single leftover unit to the first region in id order", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -1\n",
        "scenarios/baseline.yaml": scenario(THIRDS, hook(1, "drain")),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(666_666n);
    expect(held(result, 1, "salt", "north")).toBe(666_667n);
    expect(held(result, 1, "salt", "west")).toBe(666_667n);
  });

  it("walks two leftover units down the region order", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -2\n",
        "scenarios/baseline.yaml": scenario(THIRDS, hook(1, "drain")),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(333_333n);
    expect(held(result, 1, "salt", "north")).toBe(333_333n);
    expect(held(result, 1, "salt", "west")).toBe(333_334n);
  });

  it("splits evenly across pools that hold nothing between them", () => {
    const result = run(
      {
        "events/seed.yaml":
          "kind: event\nid: seed\neffects:\n  - resource: salt\n    quantity: 1\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "0") + pool("salt", "north", "0") + pool("salt", "west", "0"),
          hook(1, "seed"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(333_334n);
    expect(held(result, 1, "salt", "north")).toBe(333_333n);
    expect(held(result, 1, "salt", "west")).toBe(333_333n);
  });

  it("reaches only the region an effect names", () => {
    const result = run(
      {
        "events/drain-north.yaml":
          "kind: event\nid: drain-north\neffects:\n  - resource: salt\n    region: north\n    quantity: -4\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "10") + pool("salt", "north", "10"),
          hook(1, "drain-north"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(10_000_000n);
    expect(held(result, 1, "salt", "north")).toBe(6_000_000n);
  });

  it("takes no more from a pool than the pool holds", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -15\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "2") + pool("salt", "north", "8"),
          hook(1, "drain"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(0n);
    expect(held(result, 1, "salt", "north")).toBe(0n);
  });

  it("reports the quantity a pool really gave up", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -15\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "2") + pool("salt", "north", "8"),
          hook(1, "drain"),
        ),
      },
      2,
    );
    const quantities = disturbanceFlows(result, 1)
      .map((flow) => flow.quantity)
      .sort();
    expect(quantities).toEqual(["2.000000", "8.000000"]);
  });

  it("publishes one flow for every pool that moved", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -1\n",
        "scenarios/baseline.yaml": scenario(THIRDS, hook(1, "drain")),
      },
      2,
    );
    expect(disturbanceFlows(result, 1)).toHaveLength(3);
  });

  it("carries the moving pool's own region on each flow", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -1\n",
        "scenarios/baseline.yaml": scenario(THIRDS, hook(1, "drain")),
      },
      2,
    );
    expect(
      disturbanceFlows(result, 1)
        .map((flow) => flow.region)
        .sort(),
    ).toEqual(["east", "north", "west"]);
  });

  it("says nothing about a pool it never moved", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -1\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "0") + pool("salt", "north", "5"),
          hook(1, "drain"),
        ),
      },
      2,
    );
    const flows = disturbanceFlows(result, 1);
    expect(flows).toHaveLength(1);
    expect(flows[0]?.region).toBe("north");
  });

  it("runs an effect that named no window on its hook tick alone", () => {
    const result = run(
      {
        "events/drain.yaml":
          "kind: event\nid: drain\neffects:\n  - resource: salt\n    quantity: -1\n",
        "scenarios/baseline.yaml": scenario(pool("salt", "east", "10"), hook(1, "drain")),
      },
      3,
    );
    expect(held(result, 1, "salt", "east")).toBe(9_000_000n);
    expect(held(result, 2, "salt", "east")).toBe(9_000_000n);
    expect(disturbanceFlows(result, 2)).toEqual([]);
  });

  it("runs the effects of one event in the order the file lists them", () => {
    const result = run(
      {
        "events/double-drain.yaml":
          "kind: event\nid: double-drain\neffects:\n  - resource: salt\n    region: east\n    quantity: -2\n  - resource: salt\n    quantity: -6\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "4") + pool("salt", "north", "8"),
          hook(1, "double-drain"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(800_000n);
    expect(held(result, 1, "salt", "north")).toBe(3_200_000n);
  });

  it("keeps an effect running for the whole window it authored", () => {
    const result = run(
      {
        "events/long-drain.yaml":
          "kind: event\nid: long-drain\neffects:\n  - resource: salt\n    quantity: -1\n    forTicks: 3\n",
        "scenarios/baseline.yaml": scenario(pool("salt", "east", "10"), hook(2, "long-drain")),
      },
      5,
    );
    expect(held(result, 1, "salt", "east")).toBe(10_000_000n);
    expect(held(result, 4, "salt", "east")).toBe(7_000_000n);
  });

  it("closes a window on the tick after it ends", () => {
    const result = run(
      {
        "events/long-drain.yaml":
          "kind: event\nid: long-drain\neffects:\n  - resource: salt\n    quantity: -1\n    forTicks: 3\n",
        "scenarios/baseline.yaml": scenario(pool("salt", "east", "10"), hook(2, "long-drain")),
      },
      5,
    );
    expect(disturbanceFlows(result, 5)).toEqual([]);
    expect(held(result, 5, "salt", "east")).toBe(7_000_000n);
  });

  it("runs two disturbances on one tick in event id order", () => {
    const result = run(
      {
        "events/alpha-drain.yaml":
          "kind: event\nid: alpha-drain\neffects:\n  - resource: salt\n    region: east\n    quantity: -2\n",
        "events/beta-drain.yaml":
          "kind: event\nid: beta-drain\neffects:\n  - resource: salt\n    quantity: -6\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "4") + pool("salt", "north", "8"),
          hook(1, "beta-drain") + hook(1, "alpha-drain"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(800_000n);
    expect(held(result, 1, "salt", "north")).toBe(3_200_000n);
  });

  it("scales renewal while a modifier window runs", () => {
    const result = run(
      {
        "events/bloom.yaml":
          "kind: event\nid: bloom\neffects:\n  - modifier: moss-growth\n    factor: 2\n",
        "scenarios/baseline.yaml": scenario(pool("moss", "west", "0"), hook(1, "bloom")),
      },
      3,
    );
    expect(held(result, 1, "moss", "west")).toBe(200_000_000n);
    expect(held(result, 2, "moss", "west")).toBe(300_000_000n);
  });

  it("multiplies two windows over one key, rounding at each step", () => {
    const result = run(
      {
        "events/bloom-a.yaml":
          "kind: event\nid: bloom-a\neffects:\n  - modifier: moss-growth\n    factor: 0.333333\n",
        "events/bloom-b.yaml":
          "kind: event\nid: bloom-b\neffects:\n  - modifier: moss-growth\n    factor: 0.333333\n",
        "scenarios/baseline.yaml": scenario(
          pool("moss", "west", "0"),
          hook(1, "bloom-a") + hook(1, "bloom-b"),
        ),
      },
      2,
    );
    expect(held(result, 1, "moss", "west")).toBe(11_111_100n);
  });

  it("gives renewal back once the window closes", () => {
    const result = run(
      {
        "events/bloom.yaml":
          "kind: event\nid: bloom\neffects:\n  - modifier: moss-growth\n    factor: 2\n    forTicks: 2\n",
        "scenarios/baseline.yaml": scenario(pool("moss", "west", "0"), hook(1, "bloom")),
      },
      3,
    );
    expect(held(result, 2, "moss", "west")).toBe(400_000_000n);
    expect(held(result, 3, "moss", "west")).toBe(500_000_000n);
  });

  it("leaves a modifier effect out of the flow record", () => {
    const result = run(
      {
        "events/bloom.yaml":
          "kind: event\nid: bloom\neffects:\n  - modifier: moss-growth\n    factor: 2\n",
        "scenarios/baseline.yaml": scenario(pool("moss", "west", "0"), hook(1, "bloom")),
      },
      2,
    );
    expect(disturbanceFlows(result, 1)).toEqual([]);
    expect(result.flows.some((flow) => flow.cause === "resource-renewal" && flow.tick === 1)).toBe(
      true,
    );
  });

  it("spreads an addition the same way it spreads a withdrawal", () => {
    const result = run(
      {
        "events/silt.yaml":
          "kind: event\nid: silt\neffects:\n  - resource: salt\n    quantity: 6\n",
        "scenarios/baseline.yaml": scenario(
          pool("salt", "east", "2") + pool("salt", "north", "10"),
          hook(1, "silt"),
        ),
      },
      2,
    );
    expect(held(result, 1, "salt", "east")).toBe(3_000_000n);
    expect(held(result, 1, "salt", "north")).toBe(15_000_000n);
  });

  it("does nothing for a resource the scenario never pooled", () => {
    const result = run(
      {
        "events/drain-moss.yaml":
          "kind: event\nid: drain-moss\neffects:\n  - resource: moss\n    quantity: -3\n",
        "scenarios/baseline.yaml": scenario(pool("salt", "east", "10"), hook(1, "drain-moss")),
      },
      2,
    );
    expect(disturbanceFlows(result, 1)).toEqual([]);
    expect(held(result, 1, "salt", "east")).toBe(10_000_000n);
  });

  it("runs only the part of a window that falls inside the run", () => {
    const result = run(
      {
        "events/early-drain.yaml":
          "kind: event\nid: early-drain\neffects:\n  - resource: salt\n    quantity: -1\n    forTicks: 2\n",
        "scenarios/baseline.yaml": scenario(pool("salt", "east", "10"), hook(0, "early-drain")),
      },
      3,
    );
    expect(held(result, 1, "salt", "east")).toBe(9_000_000n);
    expect(held(result, 2, "salt", "east")).toBe(9_000_000n);
  });

  it("keeps a modifier effect inside the region it names", () => {
    const result = run(
      {
        "events/bloom-west.yaml":
          "kind: event\nid: bloom-west\neffects:\n  - modifier: moss-growth\n    region: west\n    factor: 3\n",
        "scenarios/baseline.yaml": scenario(
          pool("moss", "east", "0") + pool("moss", "west", "0"),
          hook(1, "bloom-west"),
        ),
      },
      2,
    );
    expect(held(result, 1, "moss", "west")).toBe(300_000_000n);
    expect(held(result, 1, "moss", "east")).toBe(100_000_000n);
  });
});
