/** What a crowded region says: flows, alert, command line, refusals. */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { runCommand } from "@biomeweaver/cli";
import { DEFAULT_SCALE, parseFixed } from "@biomeweaver/fixed-point";
import { simulate } from "@biomeweaver/tick-runtime";

const MANIFEST = `biome: seat-report
displayName: Seat Report
calendar: seat-year
defaultScenario: baseline

include:
  regions: regions/*.yaml
  habitats: habitats/*.yaml
  species: species/*.yaml
  resources: resources/*.yaml
  calendars: calendars/*.yaml
  scenarios: scenarios/*.yaml
  events: events/*.yaml

precision:
  scale: 1000000
  rounding: half-even
`;

const CALENDAR =
  "kind: calendar\nid: seat-year\nseasons:\n  - id: winter\n    startTick: 0\n    endTick: 1\n  - id: summer\n    startTick: 2\n    endTick: 3\n";

const HARE = `kind: species
id: hare
name: Hare
stages:
  - juvenile
  - adult
initialStage: adult
needs: []
space:
  juvenile: 0.5
  adult: 1
mortality:
  juvenile: 0
  adult: 0
transitions: []
`;

const SCENARIO = `kind: scenario
id: baseline
durationTicks: 2
initialPopulations:
  - species: hare
    stage: adult
    region: basin
    count: 90
  - species: hare
    stage: juvenile
    region: basin
    count: 40
initialResources: []
events: []
`;

function capsule(files: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "seat-report-"));
  const written: Record<string, string> = {
    "biomeweaver.yaml": MANIFEST,
    "calendars/seat-year.yaml": CALENDAR,
    "events/none.yaml": "kind: event\nid: nothing\neffects: []\n",
    "resources/grass.yaml":
      "kind: resource\nid: grass\nname: Grass\nrenewable: false\nrenewalPerTick: 0\n",
    "regions/basin.yaml": "kind: region\nid: basin\nname: basin\n",
    "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\n",
    "habitats/ridge.yaml": "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: 40\n",
    "species/hare.yaml": HARE,
    "scenarios/baseline.yaml": SCENARIO,
    ...files,
  };
  for (const [relative, text] of Object.entries(written)) {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

function crowdedRun(root: string, ticks = 1) {
  const compiled = compileCapsule({ root });
  return simulate(compiled.model!, compiled.model!.scenarios["baseline"]!, ticks);
}

describe("what a crowded region reports", () => {
  it("writes a population flow for every cohort it takes from", () => {
    const result = crowdedRun(capsule());
    const taken = result.flows.filter(
      (flow) => flow.cause === "habitat-crowding" && flow.kind === "population-decrease",
    );
    expect(taken.map((flow) => `${flow.stage} ${flow.quantity} ${flow.rule}`).sort()).toEqual([
      "adult 8.181819 hare.capacity.basin",
      "juvenile 3.636362 hare.capacity.basin",
    ]);
  });

  it("writes a condition flow carrying the drop it made", () => {
    const result = crowdedRun(capsule());
    const changed = result.flows.filter(
      (flow) => flow.cause === "habitat-crowding" && flow.kind === "condition-change",
    );
    expect(changed).toHaveLength(2);
    for (const flow of changed) {
      expect(flow.quantity).toBe("0.090909");
      expect(flow.region).toBe("basin");
      expect(parseFixed(flow.quantity, DEFAULT_SCALE) >= 0n).toBe(true);
    }
  });

  it("writes nothing for a region that stays inside its seats", () => {
    const roomy = crowdedRun(
      capsule({
        "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 400\n",
      }),
    );
    expect(roomy.flows.filter((flow) => flow.cause === "habitat-crowding")).toEqual([]);
    const tight = crowdedRun(capsule());
    expect(tight.flows.filter((flow) => flow.cause === "habitat-crowding").length).toBeGreaterThan(
      0,
    );
  });

  it("raises an alert naming the species and the region", () => {
    const result = crowdedRun(capsule());
    expect(result.states[1]?.alerts.some((alert) => alert.includes("hare"))).toBe(true);
    expect(result.states[1]?.alerts.some((alert) => alert.includes("basin"))).toBe(true);
  });

  it("makes simulate report ecological alerts", () => {
    const root = capsule();
    expect(runCommand(["simulate", "baseline", "--ticks", "1", "--root", root]).exitCode).toBe(2);
    const roomy = capsule({
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 400\n",
    });
    expect(runCommand(["simulate", "baseline", "--ticks", "1", "--root", roomy]).exitCode).toBe(0);
  });

  it("lists the seats a capsule offers season by season", () => {
    const result = runCommand(["pressure", "--root", capsule(), "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout) as {
      season: string;
      species: string;
      region: string;
      habitat: string;
      seats: string;
    }[];
    expect(
      rows
        .map((row) => `${row.season} ${row.species} ${row.region} ${row.habitat} ${row.seats}`)
        .sort(),
    ).toEqual([
      "summer hare basin marsh 60.000000",
      "summer hare basin ridge 40.000000",
      "winter hare basin marsh 60.000000",
      "winter hare basin ridge 40.000000",
    ]);
  });

  it("prints the same seats as text", () => {
    const result = runCommand(["pressure", "--root", capsule()]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hare");
    expect(result.stdout).toContain("60.000000");
  });

  it("reports occupancy against seats tick by tick", () => {
    const root = capsule();
    const simulated = runCommand(["simulate", "baseline", "--ticks", "1", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const result = runCommand(["pressure", runId, "--root", root, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout) as {
      tick: number;
      species: string;
      region: string;
      occupied: string;
      seats: string;
      pressure: string;
    }[];
    const first = rows.find((row) => row.tick === 0);
    const second = rows.find((row) => row.tick === 1);
    expect([first?.species, first?.region]).toEqual(["hare", "basin"]);
    expect([first?.occupied, first?.seats, first?.pressure]).toEqual([
      "110.000000",
      "100.000000",
      "1.100000",
    ]);
    expect([second?.occupied, second?.seats, second?.pressure]).toEqual([
      "100.000000",
      "100.000000",
      "1.000000",
    ]);
  });

  it("keeps only the species asked for", () => {
    const root = capsule({
      "species/vole.yaml": HARE.replace("id: hare", "id: vole").replace("name: Hare", "name: Vole"),
      "habitats/ridge.yaml":
        "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: 40\n  vole: 5\n",
      "scenarios/baseline.yaml": SCENARIO.replace(
        "initialResources: []",
        "  - species: vole\n    stage: adult\n    region: basin\n    count: 50\ninitialResources: []",
      ),
    });
    const simulated = runCommand(["simulate", "baseline", "--ticks", "1", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const json = ["--root", root, "--format", "json"];
    const every = JSON.parse(runCommand(["pressure", runId, ...json]).stdout) as {
      species: string;
    }[];
    const only = JSON.parse(
      runCommand(["pressure", runId, "--species", "vole", ...json]).stdout,
    ) as { species: string }[];
    expect(every.some((row) => row.species === "hare")).toBe(true);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((row) => row.species === "vole")).toBe(true);
  });

  it("gives the Markdown report a section for what crowding took", () => {
    const root = capsule();
    const simulated = runCommand(["simulate", "baseline", "--ticks", "1", "--root", root]);
    const runId = /run ([0-9a-f]+)/.exec(simulated.stdout)?.[1] ?? "";
    const report = runCommand(["report", runId, "--root", root, "--format", "markdown"]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("11.818181");
  });

  it("refuses a habitat that seats a species the capsule does not define", () => {
    const root = capsule({
      "habitats/ridge.yaml": "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  wolf: 40\n",
    });
    expect(runCommand(["check", "--root", root]).exitCode).toBe(3);
  });

  it("refuses space given to a stage the species does not have", () => {
    const root = capsule({
      "species/hare.yaml": HARE.replace("  juvenile: 0.5", "  fledgling: 0.5"),
    });
    expect(runCommand(["check", "--root", root]).exitCode).toBe(3);
  });

  it("refuses a negative seat count and negative space", () => {
    const negativeSeats = capsule({
      "habitats/ridge.yaml": "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: -1\n",
    });
    expect(runCommand(["check", "--root", negativeSeats]).exitCode).toBe(3);
    const negativeSpace = capsule({
      "species/hare.yaml": HARE.replace("  adult: 1", "  adult: -1"),
    });
    expect(runCommand(["check", "--root", negativeSpace]).exitCode).toBe(3);
  });

  it("warns without refusing when seats are offered to a species no scenario places there", () => {
    const root = capsule({
      "species/vole.yaml": HARE.replace("id: hare", "id: vole").replace("name: Hare", "name: Vole"),
      "habitats/ridge.yaml":
        "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: 40\n  vole: 5\n",
    });
    const compiled = compileCapsule({ root });
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const warnings = compiled.diagnostics.filter((item) => item.severity === "warning");
    expect(warnings.length).toBeGreaterThan(0);
    expect(runCommand(["check", "--root", root]).exitCode).toBe(0);
  });
});
