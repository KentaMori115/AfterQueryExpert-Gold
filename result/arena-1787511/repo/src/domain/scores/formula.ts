import { InvalidArgumentError } from "../../errors.js";
import type { MatchOutcome, ScoringConfig } from "../../types.js";

export interface FormulaContext {
  readonly outcome: MatchOutcome;
  readonly rawScore: number;
  readonly streak: number;
  readonly vip: boolean;
  readonly config: ScoringConfig;
}

export function basePointsFor(outcome: MatchOutcome, config: ScoringConfig): number {
  switch (outcome) {
    case "win":
      return config.winPoints;
    case "loss":
      return config.lossPoints;
    case "draw":
      return config.drawPoints;
    case "forfeit":
      return config.forfeitPoints;
    default: {
      const _never: never = outcome;
      throw new InvalidArgumentError("unknown outcome", { outcome: _never });
    }
  }
}

export function streakBonus(streak: number, config: ScoringConfig): number {
  if (streak <= 0 || streak % config.streakBonusEvery !== 0) {
    return 0;
  }
  return config.streakBonusPoints;
}

export function applyVipMultiplier(points: number, vip: boolean, config: ScoringConfig): number {
  if (!vip || config.vipMultiplier === 1) {
    return points;
  }
  return points * config.vipMultiplier;
}

export function evaluateCustomFormula(expression: string, context: FormulaContext): number {
  const allowed = /^[0-9+\-*/().\sA-Z_]+$/i;
  if (!allowed.test(expression)) {
    throw new InvalidArgumentError("custom formula contains unsupported characters", { expression });
  }
  const replacements: Record<string, number> = {
    WIN: context.config.winPoints,
    LOSS: context.config.lossPoints,
    DRAW: context.config.drawPoints,
    FORFEIT: context.config.forfeitPoints,
    RAW: context.rawScore,
    STREAK: context.streak,
    VIP: context.vip ? 1 : 0,
    VIP_MULT: context.config.vipMultiplier,
    BASE: basePointsFor(context.outcome, context.config),
  };
  let resolved = expression;
  for (const [token, value] of Object.entries(replacements)) {
    resolved = resolved.replaceAll(token, String(value));
  }
  if (!/^[0-9+\-*/().\s]+$/.test(resolved)) {
    throw new InvalidArgumentError("custom formula could not be resolved", { expression, resolved });
  }
  const result = Function(`"use strict"; return (${resolved});`)();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new InvalidArgumentError("custom formula did not return a finite number", { expression, result });
  }
  return result;
}
