/**
 * Seats, and what a region does when more stands in it than the habitats
 * there offer room for. Capsules are written out in full: the shipped biome
 * never crowds, so the arithmetic never shows there.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { DEFAULT_SCALE, parseFixed } from "@biomeweaver/fixed-point";
import { simulate, type TickState } from "@biomeweaver/tick-runtime";

const MANIFEST = `biome: seat-lab
displayName: Seat Lab
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

const CALENDAR = `kind: calendar
id: seat-year
seasons:
  - id: winter
    startTick: 0
    endTick: 1
  - id: summer
    startTick: 2
    endTick: 3
`;

function capsule(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "seat-lab-"));
  const written: Record<string, string> = {
    "biomeweaver.yaml": MANIFEST,
    "calendars/seat-year.yaml": CALENDAR,
    "events/none.yaml": "kind: event\nid: nothing\neffects: []\n",
    "resources/grass.yaml":
      "kind: resource\nid: grass\nname: Grass\nrenewable: false\nrenewalPerTick: 0\n",
    ...files,
  };
  for (const [relative, text] of Object.entries(written)) {
    const target = join(root, relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

function region(id: string): string {
  return `kind: region\nid: ${id}\nname: ${id}\n`;
}

function run(root: string, ticks: number): readonly TickState[] {
  const compiled = compileCapsule({ root });
  expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const model = compiled.model;
  expect(model).toBeDefined();
  const scenario = model?.scenarios["baseline"];
  expect(scenario).toBeDefined();
  return simulate(model!, scenario!, ticks).states;
}

function at(state: TickState | undefined, species: string, stage: string) {
  return state?.cohorts.find((item) => item.species === species && item.stage === stage);
}

function countOf(state: TickState | undefined, species: string, stage: string): string {
  return at(state, species, stage)?.count.toString() ?? "missing";
}

function conditionOf(state: TickState | undefined, species: string, stage: string): string {
  return at(state, species, stage)?.condition.toString() ?? "missing";
}

function fixed(text: string): string {
  return parseFixed(text, DEFAULT_SCALE).toString();
}

const HARE_HALF = `kind: species
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

const HARE_PLAIN = `kind: species
id: hare
name: Hare
stages:
  - juvenile
  - adult
initialStage: adult
needs: []
mortality:
  juvenile: 0
  adult: 0
transitions: []
`;

function scenario(rows: readonly string[], ticks = 4): string {
  return `kind: scenario
id: baseline
durationTicks: ${ticks}
initialPopulations:
${rows.join("")}initialResources: []
events: []
`;
}

function population(species: string, stage: string, place: string, count: string): string {
  return `  - species: ${species}\n    stage: ${stage}\n    region: ${place}\n    count: ${count}\n`;
}

describe("seats a region offers", () => {
  it("adds up the seats every habitat on the region offers", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\n",
      "habitats/ridge.yaml": "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: 40\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "juvenile", "basin", "40"),
      ]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("81.818181"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("36.363638"));
  });

  it("scales one habitat's seats by the season modifier named for the species", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml":
        "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\nmodifiers:\n  summer:\n    hare-capacity: 0.5\n",
      "habitats/ridge.yaml": "kind: habitat\nid: ridge\nregion: basin\ncapacity:\n  hare: 40\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "juvenile", "basin", "40"),
      ]),
    });
    const states = run(root, 3);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("81.818181"));
    expect(countOf(states[2], "hare", "adult")).toBe(fixed("81.818181"));
    expect(countOf(states[3], "hare", "adult")).toBe(fixed("57.272726"));
    expect(countOf(states[3], "hare", "juvenile")).toBe(fixed("25.454548"));
  });

  it("gives a stage with no authored space one seat each", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 100\n",
      "species/hare.yaml": HARE_PLAIN,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "juvenile", "basin", "40"),
      ]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("69.230769"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("30.769231"));
  });

  it("gives no room at all to a stage authored at zero space", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\n",
      "species/hare.yaml": HARE_PLAIN.replace(
        "mortality:",
        "space:\n  juvenile: 0\n  adult: 1\nmortality:",
      ),
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "juvenile", "basin", "40"),
      ]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("60"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("40"));
    expect(conditionOf(states[1], "hare", "juvenile")).toBe(fixed("1"));
  });

  it("leaves a species no habitat on the region seats where it stands", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\n",
      "species/hare.yaml": HARE_HALF,
      "species/vole.yaml": HARE_HALF.replace("id: hare", "id: vole").replace(
        "name: Hare",
        "name: Vole",
      ),
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("vole", "adult", "basin", "400"),
      ]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("60"));
    expect(countOf(states[1], "vole", "adult")).toBe(fixed("400"));
  });

  it("leaves a region with no habitat on it alone", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "regions/ridge.yaml": region("ridge"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 60\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "adult", "ridge", "900"),
      ]),
    });
    const states = run(root, 1);
    const basin = states[1]?.cohorts.find((item) => item.region === "basin");
    const ridge = states[1]?.cohorts.find((item) => item.region === "ridge");
    expect(basin?.count.toString()).toBe(fixed("60"));
    expect(ridge?.count.toString()).toBe(fixed("900"));
    expect(ridge?.condition.toString()).toBe(fixed("1"));
  });

  it("empties a region whose habitats seat the species at zero", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 0\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([population("hare", "adult", "basin", "30")]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe("0");
  });

  it("hands a leftover unit to the cohort whose key sorts first", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml":
        'kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: "49.999999"\n',
      "species/hare.yaml": HARE_PLAIN,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "25"),
        population("hare", "juvenile", "basin", "25"),
      ]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("24.999999"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("25"));
  });

  it("divides the condition of a cohort that keeps its seat by the pressure", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 100\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "juvenile", "basin", "40"),
      ]),
    });
    const states = run(root, 2);
    expect(conditionOf(states[1], "hare", "adult")).toBe(fixed("0.909091"));
    expect(conditionOf(states[1], "hare", "juvenile")).toBe(fixed("0.909091"));
    expect(conditionOf(states[2], "hare", "adult")).toBe(fixed("0.909091"));
  });

  it("counts the young born this tick before the seats are enforced", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 100\n",
      "species/hare.yaml": `kind: species
id: hare
name: Hare
stages:
  - juvenile
  - adult
initialStage: adult
needs: []
reproduction:
  stage: adult
  offspringStage: juvenile
  baseRatePerTick: 0.04
  requiresConditionAtLeast: 0
mortality:
  juvenile: 0
  adult: 0
transitions: []
`,
      "scenarios/baseline.yaml": scenario([population("hare", "adult", "basin", "100")]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("96.153846"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("3.846154"));
  });

  it("counts a cohort that advanced this tick under the space of its new stage", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 30\n",
      "species/hare.yaml": `kind: species
id: hare
name: Hare
stages:
  - juvenile
  - adult
initialStage: juvenile
needs: []
space:
  juvenile: 0
  adult: 1
mortality:
  juvenile: 0
  adult: 0
transitions:
  - from: juvenile
    to: adult
    afterTicks: 1
`,
      "scenarios/baseline.yaml": scenario([population("hare", "juvenile", "basin", "40")]),
    });
    const states = run(root, 1);
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("30"));
    expect(conditionOf(states[1], "hare", "adult")).toBe(fixed("0.75"));
  });

  it("never leaves a negative count behind", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 1\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "500"),
        population("hare", "juvenile", "basin", "500"),
      ]),
    });
    const states = run(root, 3);
    for (const state of states) {
      for (const cohort of state.cohorts) {
        expect(cohort.count >= 0n).toBe(true);
      }
    }
    expect(countOf(states[1], "hare", "adult")).toBe(fixed("0.666666"));
    expect(countOf(states[1], "hare", "juvenile")).toBe(fixed("0.666668"));
  });

  it("leaves a region that stays inside its seats untouched", () => {
    const root = capsule({
      "regions/basin.yaml": region("basin"),
      "regions/ridge.yaml": region("ridge"),
      "habitats/marsh.yaml": "kind: habitat\nid: marsh\nregion: basin\ncapacity:\n  hare: 400\n",
      "habitats/scree.yaml": "kind: habitat\nid: scree\nregion: ridge\ncapacity:\n  hare: 10\n",
      "species/hare.yaml": HARE_HALF,
      "scenarios/baseline.yaml": scenario([
        population("hare", "adult", "basin", "90"),
        population("hare", "adult", "ridge", "90"),
      ]),
    });
    const states = run(root, 1);
    const basin = states[1]?.cohorts.find((item) => item.region === "basin");
    const ridge = states[1]?.cohorts.find((item) => item.region === "ridge");
    expect(basin?.count.toString()).toBe(fixed("90"));
    expect(basin?.condition.toString()).toBe(fixed("1"));
    expect(ridge?.count.toString()).toBe(fixed("10"));
  });
});
