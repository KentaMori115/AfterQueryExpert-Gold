import { explain, type DecisionExplanation } from "../../explain.js";
import type { ScoringConfig } from "../../types.js";

export interface BonusDecision {
  readonly amount: number;
  readonly explanation: DecisionExplanation;
}

export function winStreakBonus(streak: number, config: ScoringConfig): BonusDecision {
  const hits = streak > 0 && streak % config.streakBonusEvery === 0;
  const amount = hits ? config.streakBonusPoints : 0;
  return {
    amount,
    explanation: explain(
      hits ? "bonus.streak" : "bonus.streak.none",
      hits
        ? `${streak} win streak awards ${config.streakBonusPoints}`
        : `streak ${streak} does not award a bonus`,
      { streak, every: config.streakBonusEvery, amount },
    ),
  };
}

export function vipMultiplierBonus(points: number, vip: boolean, config: ScoringConfig): BonusDecision {
  if (!vip || config.vipMultiplier === 1) {
    return {
      amount: 0,
      explanation: explain("bonus.vip.none", "no vip multiplier applied", { points, vip }),
    };
  }
  const amount = points * config.vipMultiplier - points;
  return {
    amount,
    explanation: explain("bonus.vip", `vip multiplier ${config.vipMultiplier}`, {
      points,
      multiplier: config.vipMultiplier,
      amount,
    }),
  };
}

export function perfectGameBonus(rawScore: number, threshold = 100): BonusDecision {
  const amount = rawScore >= threshold ? Math.floor(rawScore / 20) : 0;
  return {
    amount,
    explanation: explain(
      amount > 0 ? "bonus.perfect" : "bonus.perfect.none",
      amount > 0 ? `raw score ${rawScore} earns a perfect-game bonus` : "no perfect-game bonus",
      { rawScore, threshold, amount },
    ),
  };
}

export function sumBonuses(decisions: readonly BonusDecision[]): BonusDecision {
  const amount = decisions.reduce((total, decision) => total + decision.amount, 0);
  return {
    amount,
    explanation: explain("bonus.sum", `combined bonus ${amount}`, {
      amount,
      parts: decisions.map((decision) => decision.explanation),
    }),
  };
}
