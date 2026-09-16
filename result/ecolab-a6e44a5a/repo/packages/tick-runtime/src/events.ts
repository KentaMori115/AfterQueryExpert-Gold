import {
  coversTick,
  isModifierEffect,
  isQuantityEffect,
  type CompiledBiome,
  type EventEffect,
  type ScenarioRecord,
} from "@biomeweaver/biome-model";
import {
  assignRemainders,
  min,
  proportionalShares,
  type Fixed,
  type RemainderShare,
} from "@biomeweaver/fixed-point";
import { resourceFlow, type AttributedFlow } from "@biomeweaver/flow-explanations";
import type { ModifierOverride } from "@biomeweaver/resource-engine";
import type { PoolState } from "./state.js";

/** One authored effect, together with the event that carries it. */
export type FiringEffect = {
  readonly event: string;
  readonly effect: EventEffect;
};

export type DisturbanceResult = {
  readonly pools: readonly PoolState[];
  readonly flows: readonly AttributedFlow[];
  readonly overrides: readonly ModifierOverride[];
};

/**
 * Every effect that is running on `tick`.
 *
 * A scenario hook opens each of its event's effects on the hook's own tick and
 * holds it open for that effect's window. Hooks are read in tick order and then
 * by event id, so two disturbances that open on one tick always fire in the
 * same order whatever order the scenario file listed them in.
 */
export function firingEffects(
  model: CompiledBiome,
  scenario: ScenarioRecord,
  tick: number,
): FiringEffect[] {
  const hooks = [...scenario.events].sort(
    (left, right) => left.atTick - right.atTick || left.event.localeCompare(right.event),
  );
  const firing: FiringEffect[] = [];
  for (const hook of hooks) {
    const event = model.events[hook.event];
    if (!event) {
      continue;
    }
    for (const effect of event.effects) {
      if (coversTick(hook.atTick, effect, tick)) {
        firing.push({ event: event.id, effect });
      }
    }
  }
  return firing;
}

/**
 * Indices of the pools an effect reaches, in region id order. An effect that
 * names a region reaches that region alone; one that names none reaches every
 * pool of the resource.
 */
export function targetPools(pools: readonly PoolState[], effect: EventEffect): number[] {
  const indices: number[] = [];
  for (const [index, pool] of pools.entries()) {
    if (pool.resource !== effect.resource) {
      continue;
    }
    if (effect.region !== undefined && pool.region !== effect.region) {
      continue;
    }
    indices.push(index);
  }
  return indices.sort((left, right) => {
    const leftPool = pools[left];
    const rightPool = pools[right];
    const byRegion = (leftPool?.region ?? "").localeCompare(rightPool?.region ?? "");
    return byRegion !== 0 ? byRegion : left - right;
  });
}

/**
 * Split `magnitude` over the targeted pools in proportion to what each one
 * holds. Floor division leaves a remainder below the number of targets, and
 * that remainder walks the targets in region id order, one unit each. Targets
 * that hold nothing between them split the magnitude evenly instead, so an
 * addition into an empty biome still lands somewhere.
 */
export function spreadQuantity(
  pools: readonly PoolState[],
  indices: readonly number[],
  magnitude: Fixed,
): Map<number, Fixed> {
  const holdings = indices.map((index) => pools[index]?.quantity ?? 0n);
  const held = holdings.reduce((sum, quantity) => sum + quantity, 0n);
  const weights: RemainderShare[] = indices.map((index, position) => ({
    key: String(index),
    amount: held === 0n ? 1n : (holdings[position] ?? 0n),
  }));
  const shares = proportionalShares(weights, magnitude);
  const order = indices.map((index) => String(index));
  const assigned = assignRemainders(shares.assigned, shares.remainder, order);
  const byIndex = new Map<number, Fixed>();
  for (const share of assigned) {
    byIndex.set(Number(share.key), share.amount);
  }
  return byIndex;
}

function quantityEffect(
  pools: readonly PoolState[],
  firing: FiringEffect,
  tick: number,
  scale: bigint,
): { readonly pools: readonly PoolState[]; readonly flows: readonly AttributedFlow[] } {
  const effect = firing.effect;
  if (!isQuantityEffect(effect)) {
    return { pools, flows: [] };
  }
  const indices = targetPools(pools, effect);
  if (indices.length === 0) {
    return { pools, flows: [] };
  }
  const adding = effect.quantity >= 0n;
  const magnitude = adding ? effect.quantity : -effect.quantity;
  const shares = spreadQuantity(pools, indices, magnitude);
  const next = pools.map((pool) => ({ ...pool }));
  const flows: AttributedFlow[] = [];
  for (const index of indices) {
    const pool = next[index];
    const share = shares.get(index) ?? 0n;
    if (!pool || share === 0n) {
      continue;
    }
    const moved = adding ? share : min(share, pool.quantity);
    if (moved === 0n) {
      continue;
    }
    next[index] = { ...pool, quantity: adding ? pool.quantity + moved : pool.quantity - moved };
    flows.push(
      resourceFlow(
        tick,
        adding ? "resource-increase" : "resource-decrease",
        effect.resource,
        pool.region,
        moved,
        scale,
        "fixed-event",
        `events.${firing.event}`,
      ),
    );
  }
  return { pools: next, flows };
}

function modifierOverride(firing: FiringEffect): ModifierOverride | undefined {
  const effect = firing.effect;
  if (!isModifierEffect(effect)) {
    return undefined;
  }
  return effect.region === undefined
    ? { key: effect.modifier, factor: effect.factor }
    : { key: effect.modifier, factor: effect.factor, region: effect.region };
}

/**
 * Phase one of a tick: run every disturbance that covers this tick.
 *
 * Quantity effects move resource pools straight away and publish one flow per
 * pool that actually moved, carrying that pool's own region and the amount the
 * pool really gave up or took on. Modifier effects publish nothing of their
 * own; they hand back a scaling that renewal applies later in the same tick,
 * and the renewal flow reports the difference they made.
 */
export function applyFixedEvents(
  model: CompiledBiome,
  scenario: ScenarioRecord,
  tick: number,
  pools: readonly PoolState[],
): DisturbanceResult {
  const scale = model.precision.scale;
  let current: readonly PoolState[] = pools.map((pool) => ({ ...pool }));
  const flows: AttributedFlow[] = [];
  const overrides: ModifierOverride[] = [];
  for (const firing of firingEffects(model, scenario, tick)) {
    const moved = quantityEffect(current, firing, tick, scale);
    current = moved.pools;
    flows.push(...moved.flows);
    const override = modifierOverride(firing);
    if (override) {
      overrides.push(override);
    }
  }
  return { pools: current, flows, overrides };
}
