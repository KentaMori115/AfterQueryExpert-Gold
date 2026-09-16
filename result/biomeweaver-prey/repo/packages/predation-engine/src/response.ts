import { mul, roundHalfEven, type Fixed, type Precision } from "@biomeweaver/fixed-point";
import type { PredationRule } from "@biomeweaver/biome-model";

/**
 * What one predator cohort asks a prey cohort for.
 *
 * A rule without `saturation` asks for the flat `count x perPredatorPerTick`.
 * With it, thin prey are harder to find: the ask falls off by
 * `prey / (prey + saturation)`, so a prey cohort standing at exactly the
 * saturation count gives up half the flat rate. Both forms round half-even at
 * model scale, the saturated one after the whole product.
 */
export function saturatedAsk(
  precision: Precision,
  rule: PredationRule,
  predatorCount: Fixed,
  preyCount: Fixed,
): Fixed {
  if (predatorCount <= 0n || rule.perPredatorPerTick <= 0n) {
    return 0n;
  }
  if (rule.saturation === undefined) {
    return mul(predatorCount, rule.perPredatorPerTick, precision.scale, precision.rounding);
  }
  const density = preyCount + rule.saturation;
  if (preyCount <= 0n || density <= 0n) {
    return 0n;
  }
  return roundHalfEven(
    predatorCount * rule.perPredatorPerTick * preyCount,
    precision.scale * density,
  );
}
