import type { CompiledBiome, HabitatRecord } from "@biomeweaver/biome-model";
import { mul, type Fixed } from "@biomeweaver/fixed-point";
import { scaleModifier, type ModifierOverride } from "./modifiers.js";

export function habitatModifier(
  habitats: readonly HabitatRecord[],
  region: string,
  season: string,
  key: string,
  scale: bigint,
  overrides: readonly ModifierOverride[] = [],
): Fixed {
  let factor = scale;
  for (const habitat of habitats) {
    if (habitat.region !== region) {
      continue;
    }
    const seasonMods = habitat.modifiers[season];
    const value = seasonMods?.[key];
    if (value !== undefined) {
      factor = value;
    }
  }
  return scaleModifier(factor, overrides, region, key, scale);
}

export function renewPool(
  model: CompiledBiome,
  resource: string,
  region: string,
  current: Fixed,
  season: string,
  overrides: readonly ModifierOverride[] = [],
): Fixed {
  const record = model.resources[resource];
  if (!record || !record.renewable) {
    return current;
  }
  const factor = habitatModifier(
    Object.values(model.habitats),
    region,
    season,
    `${resource}-growth`,
    model.precision.scale,
    overrides,
  );
  const growth = mul(
    record.renewalPerTick,
    factor,
    model.precision.scale,
    model.precision.rounding,
  );
  return current + growth;
}
