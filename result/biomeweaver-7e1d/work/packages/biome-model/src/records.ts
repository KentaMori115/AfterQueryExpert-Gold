import type { SourceLocation } from "@biomeweaver/capsule-source";
import type { Fixed, Precision } from "@biomeweaver/fixed-point";

export type RegionRecord = {
  readonly kind: "region";
  readonly id: string;
  readonly name: string;
  readonly location: SourceLocation;
};

export type HabitatRecord = {
  readonly kind: "habitat";
  readonly id: string;
  readonly region: string;
  readonly capacity: Readonly<Record<string, Fixed>>;
  readonly modifiers: Readonly<Record<string, Readonly<Record<string, Fixed>>>>;
  readonly location: SourceLocation;
};

export type NeedRecord = {
  readonly resource: string;
  readonly perIndividualPerTick: Fixed;
  readonly priority: number;
};

export type ReproductionRecord = {
  readonly stage: string;
  readonly offspringStage: string;
  readonly baseRatePerTick: Fixed;
  readonly requiresConditionAtLeast: Fixed;
};

export type StageTransition = {
  readonly from: string;
  readonly to: string;
  readonly afterTicks: number;
};

export type PredationRule = {
  readonly prey: string;
  readonly preyStage: string;
  readonly perPredatorPerTick: Fixed;
};

export type SpeciesRecord = {
  readonly kind: "species";
  readonly id: string;
  readonly name: string;
  readonly stages: readonly string[];
  readonly initialStage: string;
  readonly needs: readonly NeedRecord[];
  readonly reproduction?: ReproductionRecord;
  readonly mortality: Readonly<Record<string, Fixed>>;
  readonly space: Readonly<Record<string, Fixed>>;
  readonly transitions: readonly StageTransition[];
  readonly predation: readonly PredationRule[];
  readonly location: SourceLocation;
};

export type ResourceRecord = {
  readonly kind: "resource";
  readonly id: string;
  readonly name: string;
  readonly renewable: boolean;
  readonly renewalPerTick: Fixed;
  readonly location: SourceLocation;
};

export type SeasonRecord = {
  readonly id: string;
  readonly startTick: number;
  readonly endTick: number;
};

export type CalendarRecord = {
  readonly kind: "calendar";
  readonly id: string;
  readonly seasons: readonly SeasonRecord[];
  readonly location: SourceLocation;
};

export type InitialPopulation = {
  readonly species: string;
  readonly stage: string;
  readonly region: string;
  readonly count: Fixed;
};

export type InitialResource = {
  readonly resource: string;
  readonly region: string;
  readonly quantity: Fixed;
};

export type ScenarioEvent = {
  readonly atTick: number;
  readonly event: string;
};

export type ScenarioRecord = {
  readonly kind: "scenario";
  readonly id: string;
  readonly durationTicks: number;
  readonly initialPopulations: readonly InitialPopulation[];
  readonly initialResources: readonly InitialResource[];
  readonly events: readonly ScenarioEvent[];
  readonly location: SourceLocation;
};

export type EventEffect = {
  readonly resource?: string;
  readonly modifier?: string;
  readonly quantity?: Fixed;
  readonly factor?: Fixed;
};

export type EventRecord = {
  readonly kind: "event";
  readonly id: string;
  readonly effects: readonly EventEffect[];
  readonly location: SourceLocation;
};

export type CompiledBiome = {
  readonly biome: string;
  readonly displayName: string;
  readonly fingerprint: string;
  readonly precision: Precision;
  readonly calendarId: string;
  readonly defaultScenario: string;
  readonly regions: Readonly<Record<string, RegionRecord>>;
  readonly habitats: Readonly<Record<string, HabitatRecord>>;
  readonly species: Readonly<Record<string, SpeciesRecord>>;
  readonly resources: Readonly<Record<string, ResourceRecord>>;
  readonly calendars: Readonly<Record<string, CalendarRecord>>;
  readonly scenarios: Readonly<Record<string, ScenarioRecord>>;
  readonly events: Readonly<Record<string, EventRecord>>;
};
