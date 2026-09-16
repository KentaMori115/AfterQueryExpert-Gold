import { mul, type Fixed } from "@biomeweaver/fixed-point";

/**
 * A live scaling of one authored modifier key.
 *
 * Habitats author a seasonal factor per modifier key, for example
 * `fresh-water-growth`. A disturbance that is running on the current
 * tick can scale that factor while it lasts. An override without a region
 * covers every region in the biome.
 */
export type ModifierOverride = {
  readonly key: string;
  readonly factor: Fixed;
  readonly region?: string;
};

export function overrideApplies(override: ModifierOverride, region: string, key: string): boolean {
  if (override.key !== key) {
    return false;
  }
  return override.region === undefined || override.region === region;
}

export function overridesFor(
  overrides: readonly ModifierOverride[],
  region: string,
  key: string,
): readonly ModifierOverride[] {
  return overrides.filter((override) => overrideApplies(override, region, key));
}

/**
 * Fold every override that covers `region` and `key` into `base`, in the order
 * the overrides were collected. Each step rounds half-even at `scale`, so the
 * result of two overlapping windows depends on that order and not on which of
 * them happens to be larger.
 */
export function scaleModifier(
  base: Fixed,
  overrides: readonly ModifierOverride[],
  region: string,
  key: string,
  scale: bigint,
): Fixed {
  let factor = base;
  for (const override of overrides) {
    if (!overrideApplies(override, region, key)) {
      continue;
    }
    factor = mul(factor, override.factor, scale, "half-even");
  }
  return factor;
}
