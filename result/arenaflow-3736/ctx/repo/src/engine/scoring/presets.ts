import type { ScoringConfig } from "../../types.js";
import { DEFAULT_SCORING } from "../../types.js";

export const SCORING_PRESETS: Readonly<Record<string, ScoringConfig>> = {
  standard: DEFAULT_SCORING,
  conservative: {
    ...DEFAULT_SCORING,
    winPoints: 50,
    lossPoints: -10,
    drawPoints: 5,
    streakBonusPoints: 20,
  },
  aggressive: {
    ...DEFAULT_SCORING,
    winPoints: 150,
    lossPoints: -40,
    forfeitPoints: -80,
    streakBonusEvery: 3,
    streakBonusPoints: 75,
  },
  casual: {
    ...DEFAULT_SCORING,
    winPoints: 25,
    lossPoints: 0,
    drawPoints: 10,
    forfeitPoints: -5,
    vipMultiplier: 1,
    streakBonusPoints: 10,
  },
};

export function presetNames(): string[] {
  return Object.keys(SCORING_PRESETS).sort();
}

export function scoringPreset(name: string): ScoringConfig {
  const preset = SCORING_PRESETS[name];
  if (!preset) {
    return DEFAULT_SCORING;
  }
  return preset;
}
