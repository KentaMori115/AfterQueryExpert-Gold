import { DEFAULT_SCALE, formatFixed, parseFixed, type Fixed } from "@biomeweaver/fixed-point";
import type { AttributedFlow } from "@biomeweaver/flow-explanations";
import type { TickState } from "@biomeweaver/tick-runtime";

export function renderJsonReport(
  states: readonly TickState[],
  flows: readonly AttributedFlow[],
): string {
  return `${JSON.stringify({ ticks: states.map((state) => state.tick), flows }, null, 2)}\n`;
}

export function renderCsvReport(flows: readonly AttributedFlow[]): string {
  const header = "tick,kind,species,stage,region,resource,quantity,cause,rule";
  const rows = flows.map((flow) =>
    [
      flow.tick,
      flow.kind,
      flow.species ?? "",
      flow.stage ?? "",
      flow.region,
      flow.resource ?? "",
      flow.quantity,
      flow.cause,
      flow.rule,
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

export type CrowdingSummaryRow = {
  readonly species: string;
  readonly region: string;
  readonly lost: string;
  readonly ticks: number;
};

export function crowdingSummary(flows: readonly AttributedFlow[]): readonly CrowdingSummaryRow[] {
  const totals = new Map<
    string,
    { species: string; region: string; lost: Fixed; ticks: Set<number> }
  >();
  for (const flow of flows) {
    if (flow.cause !== "habitat-crowding" || flow.kind !== "population-decrease") {
      continue;
    }
    const species = flow.species ?? "";
    const key = `${species}:${flow.region}`;
    const entry = totals.get(key) ?? {
      species,
      region: flow.region,
      lost: 0n,
      ticks: new Set<number>(),
    };
    entry.lost += parseFixed(flow.quantity, DEFAULT_SCALE);
    entry.ticks.add(flow.tick);
    totals.set(key, entry);
  }
  return [...totals.values()]
    .map((entry) => ({
      species: entry.species,
      region: entry.region,
      lost: formatFixed(entry.lost, DEFAULT_SCALE),
      ticks: entry.ticks.size,
    }))
    .sort(
      (left, right) =>
        left.species.localeCompare(right.species) || left.region.localeCompare(right.region),
    );
}

export function renderMarkdownReport(
  title: string,
  states: readonly TickState[],
  flows: readonly AttributedFlow[],
): string {
  const last = states[states.length - 1];
  const lines = [
    `# ${title}`,
    "",
    `Ticks: ${states.length - 1}`,
    `Flows: ${flows.length}`,
    "",
    "## Final cohorts",
    "",
  ];
  for (const cohort of last?.cohorts ?? []) {
    lines.push(
      `- ${cohort.species} ${cohort.stage} in ${cohort.region}: ${cohort.count.toString()}`,
    );
  }
  lines.push("", "## Causes", "");
  const causes = new Map<string, number>();
  for (const flow of flows) {
    causes.set(flow.cause, (causes.get(flow.cause) ?? 0) + 1);
  }
  for (const [cause, count] of [...causes.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    lines.push(`- ${cause}: ${count}`);
  }
  const crowding = crowdingSummary(flows);
  if (crowding.length > 0) {
    lines.push("", "## Crowding", "");
    for (const row of crowding) {
      lines.push(`- ${row.species} in ${row.region}: ${row.lost} over ${row.ticks} ticks`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function populationSeries(
  states: readonly TickState[],
  species: string,
): readonly {
  readonly tick: number;
  readonly count: string;
}[] {
  return states.map((state) => ({
    tick: state.tick,
    count: state.cohorts
      .filter((cohort) => cohort.species === species)
      .reduce((sum, cohort) => sum + cohort.count, 0n)
      .toString(),
  }));
}

export function resourceSeries(
  states: readonly TickState[],
  resource: string,
): readonly {
  readonly tick: number;
  readonly quantity: string;
}[] {
  return states.map((state) => ({
    tick: state.tick,
    quantity: state.pools
      .filter((pool) => pool.resource === resource)
      .reduce((sum, pool) => sum + pool.quantity, 0n)
      .toString(),
  }));
}
