import type { PlayerRecord } from "../../types.js";

export interface ProgressionStep {
  readonly level: number;
  readonly requiredScore: number;
  readonly title: string;
}

export const DEFAULT_PROGRESSION: readonly ProgressionStep[] = [
  { level: 1, requiredScore: 0, title: "Recruit" },
  { level: 2, requiredScore: 250, title: "Contender" },
  { level: 3, requiredScore: 750, title: "Challenger" },
  { level: 4, requiredScore: 1500, title: "Veteran" },
  { level: 5, requiredScore: 3000, title: "Elite" },
  { level: 6, requiredScore: 5000, title: "Champion" },
  { level: 7, requiredScore: 8000, title: "Legend" },
];

export function levelForScore(
  totalScore: number,
  steps: readonly ProgressionStep[] = DEFAULT_PROGRESSION,
): ProgressionStep {
  let current = steps[0]!;
  for (const step of steps) {
    if (totalScore >= step.requiredScore) {
      current = step;
    }
  }
  return current;
}

export function nextStep(
  totalScore: number,
  steps: readonly ProgressionStep[] = DEFAULT_PROGRESSION,
): ProgressionStep | undefined {
  return steps.find((step) => step.requiredScore > totalScore);
}

export function applySeasonLevel(player: PlayerRecord, totalScore: number): PlayerRecord {
  const step = levelForScore(totalScore);
  return Object.freeze({ ...player, level: step.level });
}
