export { compileCapsule, type CompileResult } from "./compile.js";
export {
  decodeCalendar,
  decodeEvent,
  decodeHabitat,
  decodeRegion,
  decodeResource,
  decodeScenario,
  decodeSpecies,
} from "./decode.js";
export { cohortKey, isIdentifier, poolKey, requireIdentifier } from "./identifiers.js";
export { DEFAULT_EFFECT_TICKS, coversTick, isModifierEffect, isQuantityEffect } from "./records.js";
export type {
  CalendarRecord,
  CompiledBiome,
  EventEffect,
  EventRecord,
  HabitatRecord,
  InitialPopulation,
  InitialResource,
  NeedRecord,
  PredationRule,
  RegionRecord,
  ReproductionRecord,
  ResourceRecord,
  ScenarioEvent,
  ScenarioRecord,
  SeasonRecord,
  SpeciesRecord,
  StageTransition,
} from "./records.js";
