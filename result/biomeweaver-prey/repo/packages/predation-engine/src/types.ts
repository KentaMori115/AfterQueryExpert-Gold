import type { Fixed } from "@biomeweaver/fixed-point";

export type PredationClaim = {
  readonly key: string;
  readonly predatorKey: string;
  readonly preyKey: string;
  readonly predator: string;
  readonly predatorStage: string;
  readonly prey: string;
  readonly preyStage: string;
  readonly region: string;
  readonly rule: string;
  readonly ask: Fixed;
};

export type PredationRemoval = {
  readonly predator: string;
  readonly prey: string;
  readonly stage: string;
  readonly region: string;
  readonly quantity: Fixed;
  readonly rule: string;
};

export type PredationPressure = {
  readonly prey: string;
  readonly stage: string;
  readonly region: string;
  readonly asked: Fixed;
  readonly taken: Fixed;
};

export type ClaimSlate = {
  readonly claims: readonly PredationClaim[];
  readonly availability: ReadonlyMap<string, Fixed>;
  readonly budgets: ReadonlyMap<string, Fixed>;
};

export type SettledClaim = {
  readonly key: string;
  readonly granted: Fixed;
};

export function claimKey(
  predator: string,
  predatorStage: string,
  region: string,
  prey: string,
  preyStage: string,
): string {
  return `${predator}:${predatorStage}:${region}:${prey}:${preyStage}`;
}

export function compareKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

export function sortedKeys(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareKeys);
}
