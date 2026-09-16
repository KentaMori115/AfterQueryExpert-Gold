import {
  gatherCapsule,
  hasErrorDiagnostics,
  type Capsule,
  type Diagnostic,
  type GatheredCapsule,
} from "@biomeweaver/capsule-source";
import { parseFixed } from "@biomeweaver/fixed-point";
import {
  decodeCalendar,
  decodeEvent,
  decodeHabitat,
  decodeRegion,
  decodeResource,
  decodeScenario,
  decodeSpecies,
} from "./decode.js";
import type {
  CalendarRecord,
  CompiledBiome,
  EventRecord,
  HabitatRecord,
  RegionRecord,
  ResourceRecord,
  ScenarioRecord,
  SpeciesRecord,
} from "./records.js";
import { diagnostic, sourceLocation } from "@biomeweaver/capsule-source";

export type CompileResult = {
  readonly gathered: GatheredCapsule;
  readonly model?: CompiledBiome;
  readonly diagnostics: readonly Diagnostic[];
};

function kindOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const kind = (data as Record<string, unknown>)["kind"];
  return typeof kind === "string" ? kind : undefined;
}

export function compileCapsule(capsule: Capsule): CompileResult {
  const gathered = gatherCapsule(capsule);
  const diagnostics: Diagnostic[] = [...gathered.diagnostics];
  if (hasErrorDiagnostics(diagnostics) || gathered.fingerprint === "") {
    return { gathered, diagnostics };
  }
  const scale = parseFixed(gathered.manifest.precision.scale, 1n);
  const regions: Record<string, RegionRecord> = {};
  const habitats: Record<string, HabitatRecord> = {};
  const species: Record<string, SpeciesRecord> = {};
  const resources: Record<string, ResourceRecord> = {};
  const calendars: Record<string, CalendarRecord> = {};
  const scenarios: Record<string, ScenarioRecord> = {};
  const events: Record<string, EventRecord> = {};

  for (const document of gathered.documents) {
    const kind = kindOf(document.data) ?? document.group.replace(/s$/, "");
    if (kind === "region") {
      const decoded = decodeRegion(document.data, document.path, diagnostics);
      if (decoded) {
        if (regions[decoded.id]) {
          diagnostics.push(
            diagnostic(
              "BW-ID-005",
              "error",
              `duplicate region id ${decoded.id}`,
              document.location,
            ),
          );
        } else {
          regions[decoded.id] = decoded;
        }
      }
    } else if (kind === "habitat") {
      const decoded = decodeHabitat(document.data, document.path, scale, diagnostics);
      if (decoded) {
        habitats[decoded.id] = decoded;
      }
    } else if (kind === "species") {
      const decoded = decodeSpecies(document.data, document.path, scale, diagnostics);
      if (decoded) {
        species[decoded.id] = decoded;
      }
    } else if (kind === "resource") {
      const decoded = decodeResource(document.data, document.path, scale, diagnostics);
      if (decoded) {
        resources[decoded.id] = decoded;
      }
    } else if (kind === "calendar") {
      const decoded = decodeCalendar(document.data, document.path, diagnostics);
      if (decoded) {
        calendars[decoded.id] = decoded;
      }
    } else if (kind === "scenario") {
      const decoded = decodeScenario(document.data, document.path, scale, diagnostics);
      if (decoded) {
        scenarios[decoded.id] = decoded;
      }
    } else if (kind === "event") {
      const decoded = decodeEvent(document.data, document.path, scale, diagnostics);
      if (decoded) {
        events[decoded.id] = decoded;
      }
    }
  }

  for (const habitat of Object.values(habitats)) {
    if (!regions[habitat.region]) {
      diagnostics.push(
        diagnostic(
          "BW-ID-006",
          "error",
          `habitat ${habitat.id} references unknown region ${habitat.region}`,
          habitat.location,
        ),
      );
    }
  }
  for (const habitat of Object.values(habitats)) {
    for (const named of Object.keys(habitat.capacity)) {
      if (!species[named]) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `habitat ${habitat.id} seats unknown species ${named}`,
            habitat.location,
          ),
        );
      }
    }
  }
  for (const spec of Object.values(species)) {
    for (const stage of Object.keys(spec.space)) {
      if (!spec.stages.includes(stage)) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `species ${spec.id} gives space to unknown stage ${stage}`,
            spec.location,
          ),
        );
      }
    }
  }
  for (const spec of Object.values(species)) {
    for (const need of spec.needs) {
      if (!resources[need.resource]) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `species ${spec.id} needs unknown resource ${need.resource}`,
            spec.location,
          ),
        );
      }
    }
    for (const rule of spec.predation) {
      if (!species[rule.prey]) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `species ${spec.id} preys on unknown species ${rule.prey}`,
            spec.location,
          ),
        );
      }
    }
  }
  for (const scenario of Object.values(scenarios)) {
    for (const population of scenario.initialPopulations) {
      if (!species[population.species] || !regions[population.region]) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `scenario ${scenario.id} has an unknown population reference`,
            scenario.location,
          ),
        );
      }
    }
    for (const hook of scenario.events) {
      if (!events[hook.event]) {
        diagnostics.push(
          diagnostic(
            "BW-ID-006",
            "error",
            `scenario ${scenario.id} references unknown event ${hook.event}`,
            scenario.location,
          ),
        );
      }
    }
  }
  const placed = new Set<string>();
  for (const scenario of Object.values(scenarios)) {
    for (const population of scenario.initialPopulations) {
      placed.add(`${population.species}:${population.region}`);
    }
  }
  for (const habitat of Object.values(habitats)) {
    for (const named of Object.keys(habitat.capacity)) {
      if (!species[named] || placed.has(`${named}:${habitat.region}`)) {
        continue;
      }
      diagnostics.push(
        diagnostic(
          "BW-ID-007",
          "warning",
          `habitat ${habitat.id} seats ${named}, which no scenario places in ${habitat.region}`,
          habitat.location,
        ),
      );
    }
  }
  if (!calendars[gathered.manifest.calendar]) {
    diagnostics.push(
      diagnostic(
        "BW-ID-006",
        "error",
        `manifest calendar ${gathered.manifest.calendar} is not defined`,
        sourceLocation("biomeweaver.yaml"),
      ),
    );
  }
  if (!scenarios[gathered.manifest.defaultScenario]) {
    diagnostics.push(
      diagnostic(
        "BW-ID-006",
        "error",
        `default scenario ${gathered.manifest.defaultScenario} is not defined`,
        sourceLocation("biomeweaver.yaml"),
      ),
    );
  }

  if (hasErrorDiagnostics(diagnostics)) {
    return { gathered, diagnostics };
  }

  return {
    gathered,
    diagnostics,
    model: {
      biome: gathered.manifest.biome,
      displayName: gathered.manifest.displayName,
      fingerprint: gathered.fingerprint,
      precision: { scale, rounding: "half-even" },
      calendarId: gathered.manifest.calendar,
      defaultScenario: gathered.manifest.defaultScenario,
      regions,
      habitats,
      species,
      resources,
      calendars,
      scenarios,
      events,
    },
  };
}
