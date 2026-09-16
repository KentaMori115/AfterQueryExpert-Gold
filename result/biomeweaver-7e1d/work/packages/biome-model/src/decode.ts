import { diagnostic, sourceLocation, type Diagnostic } from "@biomeweaver/capsule-source";
import { parseFixed, type Fixed } from "@biomeweaver/fixed-point";
import { requireIdentifier } from "./identifiers.js";
import type {
  CalendarRecord,
  EventEffect,
  EventRecord,
  HabitatRecord,
  RegionRecord,
  ResourceRecord,
  ScenarioRecord,
  SpeciesRecord,
} from "./records.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseQuantity(
  value: unknown,
  scale: bigint,
  field: string,
  path: string,
  diagnostics: Diagnostic[],
): Fixed | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      diagnostics.push(
        diagnostic("BW-ID-002", "error", `${field} is not a finite quantity`, sourceLocation(path)),
      );
      return undefined;
    }
    return parseFixed(String(value), scale);
  }
  if (typeof value === "string") {
    try {
      return parseFixed(value, scale);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "BW-ID-002",
          "error",
          `${field} is not a valid fixed-point quantity: ${error instanceof Error ? error.message : value}`,
          sourceLocation(path),
        ),
      );
      return undefined;
    }
  }
  diagnostics.push(
    diagnostic(
      "BW-ID-002",
      "error",
      `${field} must be a number or decimal string`,
      sourceLocation(path),
    ),
  );
  return undefined;
}

export function decodeRegion(
  data: unknown,
  path: string,
  diagnostics: Diagnostic[],
): RegionRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  const name = record ? (asString(record["name"]) ?? id) : undefined;
  if (!record || !id || !name) {
    diagnostics.push(
      diagnostic("BW-ID-003", "error", "region records require id and name", sourceLocation(path)),
    );
    return undefined;
  }
  const checked = requireIdentifier(id, "region id", path, diagnostics);
  if (!checked) {
    return undefined;
  }
  return { kind: "region", id: checked, name, location: sourceLocation(path) };
}

export function decodeHabitat(
  data: unknown,
  path: string,
  scale: bigint,
  diagnostics: Diagnostic[],
): HabitatRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  const region = record ? asString(record["region"]) : undefined;
  if (!record || !id || !region) {
    diagnostics.push(
      diagnostic(
        "BW-ID-003",
        "error",
        "habitat records require id and region",
        sourceLocation(path),
      ),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "habitat id", path, diagnostics)) {
    return undefined;
  }
  const capacity: Record<string, Fixed> = {};
  const capacityRaw = asRecord(record["capacity"]) ?? {};
  for (const [species, value] of Object.entries(capacityRaw)) {
    const parsed = parseQuantity(value, scale, `capacity.${species}`, path, diagnostics);
    if (parsed === undefined) {
      continue;
    }
    if (parsed < 0n) {
      diagnostics.push(
        diagnostic(
          "BW-ID-004",
          "error",
          `capacity.${species} cannot be negative`,
          sourceLocation(path),
        ),
      );
      continue;
    }
    capacity[species] = parsed;
  }
  const modifiers: Record<string, Record<string, Fixed>> = {};
  const modifiersRaw = asRecord(record["modifiers"]) ?? {};
  for (const [season, values] of Object.entries(modifiersRaw)) {
    const inner = asRecord(values) ?? {};
    const seasonMods: Record<string, Fixed> = {};
    for (const [key, value] of Object.entries(inner)) {
      const parsed = parseQuantity(value, scale, `modifiers.${season}.${key}`, path, diagnostics);
      if (parsed !== undefined) {
        seasonMods[key] = parsed;
      }
    }
    modifiers[season] = seasonMods;
  }
  return {
    kind: "habitat",
    id,
    region,
    capacity,
    modifiers,
    location: sourceLocation(path),
  };
}

export function decodeSpecies(
  data: unknown,
  path: string,
  scale: bigint,
  diagnostics: Diagnostic[],
): SpeciesRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  const name = record ? (asString(record["name"]) ?? id) : undefined;
  const stages =
    record && Array.isArray(record["stages"])
      ? record["stages"].filter((s): s is string => typeof s === "string")
      : [];
  const initialStage = record ? (asString(record["initialStage"]) ?? stages[0]) : undefined;
  if (!record || !id || !name || !initialStage || stages.length === 0) {
    diagnostics.push(
      diagnostic(
        "BW-ID-003",
        "error",
        "species records require id, name, stages, and initialStage",
        sourceLocation(path),
      ),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "species id", path, diagnostics)) {
    return undefined;
  }
  const needsRaw = Array.isArray(record["needs"]) ? record["needs"] : [];
  const needs = needsRaw.flatMap((item) => {
    const need = asRecord(item);
    const resource = need ? asString(need["resource"]) : undefined;
    const priority = need ? asNumber(need["priority"]) : undefined;
    const per = need
      ? parseQuantity(
          need["perIndividualPerTick"],
          scale,
          "needs.perIndividualPerTick",
          path,
          diagnostics,
        )
      : undefined;
    if (!need || !resource || priority === undefined || per === undefined) {
      return [];
    }
    return [{ resource, perIndividualPerTick: per, priority }];
  });
  const reproductionRaw = asRecord(record["reproduction"]);
  const reproduction = reproductionRaw
    ? {
        stage: asString(reproductionRaw["stage"]) ?? "adult",
        offspringStage: asString(reproductionRaw["offspringStage"]) ?? "juvenile",
        baseRatePerTick:
          parseQuantity(
            reproductionRaw["baseRatePerTick"],
            scale,
            "reproduction.baseRatePerTick",
            path,
            diagnostics,
          ) ?? 0n,
        requiresConditionAtLeast:
          parseQuantity(
            reproductionRaw["requiresConditionAtLeast"],
            scale,
            "reproduction.requiresConditionAtLeast",
            path,
            diagnostics,
          ) ?? 0n,
      }
    : undefined;
  const mortality: Record<string, Fixed> = {};
  const mortalityRaw = asRecord(record["mortality"]) ?? {};
  for (const [stage, value] of Object.entries(mortalityRaw)) {
    const parsed = parseQuantity(value, scale, `mortality.${stage}`, path, diagnostics);
    if (parsed !== undefined) {
      mortality[stage] = parsed;
    }
  }
  const space: Record<string, Fixed> = {};
  const spaceRaw = asRecord(record["space"]) ?? {};
  for (const [stage, value] of Object.entries(spaceRaw)) {
    const parsed = parseQuantity(value, scale, `space.${stage}`, path, diagnostics);
    if (parsed === undefined) {
      continue;
    }
    if (parsed < 0n) {
      diagnostics.push(
        diagnostic("BW-ID-004", "error", `space.${stage} cannot be negative`, sourceLocation(path)),
      );
      continue;
    }
    space[stage] = parsed;
  }
  const transitionsRaw = Array.isArray(record["transitions"]) ? record["transitions"] : [];
  const transitions = transitionsRaw.flatMap((item) => {
    const row = asRecord(item);
    const from = row ? asString(row["from"]) : undefined;
    const to = row ? asString(row["to"]) : undefined;
    const afterTicks = row ? asNumber(row["afterTicks"]) : undefined;
    if (!from || !to || afterTicks === undefined) {
      return [];
    }
    return [{ from, to, afterTicks }];
  });
  const predationRaw = Array.isArray(record["predation"]) ? record["predation"] : [];
  const predation = predationRaw.flatMap((item) => {
    const row = asRecord(item);
    const prey = row ? asString(row["prey"]) : undefined;
    const preyStage = row ? (asString(row["preyStage"]) ?? "adult") : undefined;
    const per = row
      ? parseQuantity(
          row["perPredatorPerTick"],
          scale,
          "predation.perPredatorPerTick",
          path,
          diagnostics,
        )
      : undefined;
    if (!prey || !preyStage || per === undefined) {
      return [];
    }
    return [{ prey, preyStage, perPredatorPerTick: per }];
  });
  return {
    kind: "species",
    id,
    name,
    stages,
    initialStage,
    needs,
    ...(reproduction ? { reproduction } : {}),
    mortality,
    space,
    transitions,
    predation,
    location: sourceLocation(path),
  };
}

export function decodeResource(
  data: unknown,
  path: string,
  scale: bigint,
  diagnostics: Diagnostic[],
): ResourceRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  const name = record ? (asString(record["name"]) ?? id) : undefined;
  if (!record || !id || !name) {
    diagnostics.push(
      diagnostic(
        "BW-ID-003",
        "error",
        "resource records require id and name",
        sourceLocation(path),
      ),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "resource id", path, diagnostics)) {
    return undefined;
  }
  return {
    kind: "resource",
    id,
    name,
    renewable: asBoolean(record["renewable"]) ?? true,
    renewalPerTick:
      parseQuantity(record["renewalPerTick"] ?? "0", scale, "renewalPerTick", path, diagnostics) ??
      0n,
    location: sourceLocation(path),
  };
}

export function decodeCalendar(
  data: unknown,
  path: string,
  diagnostics: Diagnostic[],
): CalendarRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  if (!record || !id) {
    diagnostics.push(
      diagnostic("BW-ID-003", "error", "calendar records require id", sourceLocation(path)),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "calendar id", path, diagnostics)) {
    return undefined;
  }
  const seasonsRaw = Array.isArray(record["seasons"]) ? record["seasons"] : [];
  const seasons = seasonsRaw.flatMap((item) => {
    const row = asRecord(item);
    const seasonId = row ? asString(row["id"]) : undefined;
    const startTick = row ? asNumber(row["startTick"]) : undefined;
    const endTick = row ? asNumber(row["endTick"]) : undefined;
    if (!seasonId || startTick === undefined || endTick === undefined) {
      return [];
    }
    return [{ id: seasonId, startTick, endTick }];
  });
  return { kind: "calendar", id, seasons, location: sourceLocation(path) };
}

export function decodeScenario(
  data: unknown,
  path: string,
  scale: bigint,
  diagnostics: Diagnostic[],
): ScenarioRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  const durationTicks = record ? asNumber(record["durationTicks"]) : undefined;
  if (!record || !id || durationTicks === undefined) {
    diagnostics.push(
      diagnostic(
        "BW-ID-003",
        "error",
        "scenario records require id and durationTicks",
        sourceLocation(path),
      ),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "scenario id", path, diagnostics)) {
    return undefined;
  }
  const populations = (
    Array.isArray(record["initialPopulations"]) ? record["initialPopulations"] : []
  ).flatMap((item) => {
    const row = asRecord(item);
    const species = row ? asString(row["species"]) : undefined;
    const stage = row ? asString(row["stage"]) : undefined;
    const region = row ? asString(row["region"]) : undefined;
    const count = row
      ? parseQuantity(row["count"], scale, "initialPopulations.count", path, diagnostics)
      : undefined;
    if (!species || !stage || !region || count === undefined) {
      return [];
    }
    if (count < 0n) {
      diagnostics.push(
        diagnostic(
          "BW-ID-004",
          "error",
          "initial population count cannot be negative",
          sourceLocation(path),
        ),
      );
      return [];
    }
    return [{ species, stage, region, count }];
  });
  const resources = (
    Array.isArray(record["initialResources"]) ? record["initialResources"] : []
  ).flatMap((item) => {
    const row = asRecord(item);
    const resource = row ? asString(row["resource"]) : undefined;
    const region = row ? asString(row["region"]) : undefined;
    const quantity = row
      ? parseQuantity(row["quantity"], scale, "initialResources.quantity", path, diagnostics)
      : undefined;
    if (!resource || !region || quantity === undefined) {
      return [];
    }
    if (quantity < 0n) {
      diagnostics.push(
        diagnostic(
          "BW-ID-004",
          "error",
          "initial resource quantity cannot be negative",
          sourceLocation(path),
        ),
      );
      return [];
    }
    return [{ resource, region, quantity }];
  });
  const events = (Array.isArray(record["events"]) ? record["events"] : []).flatMap((item) => {
    const row = asRecord(item);
    const atTick = row ? asNumber(row["atTick"]) : undefined;
    const event = row ? asString(row["event"]) : undefined;
    if (atTick === undefined || !event) {
      return [];
    }
    return [{ atTick, event }];
  });
  return {
    kind: "scenario",
    id,
    durationTicks,
    initialPopulations: populations,
    initialResources: resources,
    events,
    location: sourceLocation(path),
  };
}

export function decodeEvent(
  data: unknown,
  path: string,
  scale: bigint,
  diagnostics: Diagnostic[],
): EventRecord | undefined {
  const record = asRecord(data);
  const id = record ? asString(record["id"]) : undefined;
  if (!record || !id) {
    diagnostics.push(
      diagnostic("BW-ID-003", "error", "event records require id", sourceLocation(path)),
    );
    return undefined;
  }
  if (!requireIdentifier(id, "event id", path, diagnostics)) {
    return undefined;
  }
  const effects = (Array.isArray(record["effects"]) ? record["effects"] : []).flatMap((item) => {
    const row = asRecord(item);
    if (!row) {
      return [];
    }
    const built: {
      resource?: string;
      modifier?: string;
      quantity?: Fixed;
      factor?: Fixed;
    } = {};
    const resource = asString(row["resource"]);
    const modifier = asString(row["modifier"]);
    if (resource !== undefined) {
      built.resource = resource;
    }
    if (modifier !== undefined) {
      built.modifier = modifier;
    }
    if (row["quantity"] !== undefined) {
      const quantity = parseQuantity(row["quantity"], scale, "effects.quantity", path, diagnostics);
      if (quantity !== undefined) {
        built.quantity = quantity;
      }
    }
    if (row["factor"] !== undefined) {
      const factor = parseQuantity(row["factor"], scale, "effects.factor", path, diagnostics);
      if (factor !== undefined) {
        built.factor = factor;
      }
    }
    const effect: EventEffect = built;
    return [effect];
  });
  return { kind: "event", id, effects, location: sourceLocation(path) };
}
