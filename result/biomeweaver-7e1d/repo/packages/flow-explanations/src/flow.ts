import { formatFixed, type Fixed } from "@biomeweaver/fixed-point";

export type FlowKind =
  | "population-increase"
  | "population-decrease"
  | "resource-increase"
  | "resource-decrease"
  | "condition-change"
  | "initial-state";

export type AttributedFlow = {
  readonly tick: number;
  readonly kind: FlowKind;
  readonly species?: string;
  readonly stage?: string;
  readonly region: string;
  readonly resource?: string;
  readonly quantity: string;
  readonly cause: string;
  readonly rule: string;
};

export function populationFlow(
  tick: number,
  kind: "population-increase" | "population-decrease",
  species: string,
  stage: string,
  region: string,
  quantity: Fixed,
  scale: bigint,
  cause: string,
  rule: string,
): AttributedFlow {
  return {
    tick,
    kind,
    species,
    stage,
    region,
    quantity: formatFixed(quantity < 0n ? -quantity : quantity, scale),
    cause,
    rule,
  };
}

export function resourceFlow(
  tick: number,
  kind: "resource-increase" | "resource-decrease",
  resource: string,
  region: string,
  quantity: Fixed,
  scale: bigint,
  cause: string,
  rule: string,
): AttributedFlow {
  return {
    tick,
    kind,
    resource,
    region,
    quantity: formatFixed(quantity < 0n ? -quantity : quantity, scale),
    cause,
    rule,
  };
}

export function explainFlows(
  flows: readonly AttributedFlow[],
  species: string,
  tick: number,
): readonly AttributedFlow[] {
  return flows.filter((flow) => flow.species === species && flow.tick === tick);
}
