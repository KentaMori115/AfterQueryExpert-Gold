import { explain, type DecisionExplanation } from "../../explain.js";
import type { PlayerRecord, ScoringConfig } from "../../types.js";

export interface ScoreModifier {
  readonly multiplier: number;
  readonly explanation: DecisionExplanation;
}

export function vipScoreModifier(player: PlayerRecord, scoring: ScoringConfig): ScoreModifier {
  if (!player.vip) {
    return {
      multiplier: 1,
      explanation: explain("rule.modifier.none", "player is not vip", { playerId: player.id }),
    };
  }
  return {
    multiplier: scoring.vipMultiplier,
    explanation: explain("rule.modifier.vip", "IF player.vip == true THEN score_multiplier", {
      playerId: player.id,
      multiplier: scoring.vipMultiplier,
    }),
  };
}

export function tagMultiplier(player: PlayerRecord, tag: string, multiplier: number): ScoreModifier {
  if (!player.tags.includes(tag)) {
    return {
      multiplier: 1,
      explanation: explain("rule.modifier.tag.none", `player does not have tag ${tag}`, {
        playerId: player.id,
        tag,
      }),
    };
  }
  return {
    multiplier,
    explanation: explain("rule.modifier.tag", `tag ${tag} applies multiplier`, {
      playerId: player.id,
      tag,
      multiplier,
    }),
  };
}

export function composeModifiers(modifiers: readonly ScoreModifier[]): ScoreModifier {
  const multiplier = modifiers.reduce((product, modifier) => product * modifier.multiplier, 1);
  return {
    multiplier,
    explanation: explain("rule.modifier.compose", `composed multiplier ${multiplier}`, {
      multiplier,
      parts: modifiers.map((modifier) => modifier.explanation),
    }),
  };
}
