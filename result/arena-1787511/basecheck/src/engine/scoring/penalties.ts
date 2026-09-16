import { explain, type DecisionExplanation } from "../../explain.js";

export type PenaltyReason =
  | "forfeit"
  | "late"
  | "unsportsmanlike"
  | "anti_cheat"
  | "manual";

export interface PenaltyDecision {
  readonly amount: number;
  readonly reason: PenaltyReason;
  readonly explanation: DecisionExplanation;
}

export function forfeitPenalty(baseForfeitPoints: number): PenaltyDecision {
  const amount = Math.abs(baseForfeitPoints);
  return {
    amount,
    reason: "forfeit",
    explanation: explain("penalty.forfeit", `forfeit penalty ${amount}`, { amount }),
  };
}

export function lateSubmissionPenalty(minutesLate: number): PenaltyDecision {
  const amount = Math.min(50, Math.max(0, Math.floor(minutesLate / 5) * 5));
  return {
    amount,
    reason: "late",
    explanation: explain("penalty.late", `late by ${minutesLate} minutes`, { minutesLate, amount }),
  };
}

export function unsportsmanlikePenalty(severity: 1 | 2 | 3): PenaltyDecision {
  const amount = severity * 25;
  return {
    amount,
    reason: "unsportsmanlike",
    explanation: explain("penalty.unsportsmanlike", `severity ${severity}`, { severity, amount }),
  };
}

export function antiCheatPenalty(scoreDelta: number): PenaltyDecision {
  const amount = Math.max(25, Math.abs(scoreDelta));
  return {
    amount,
    reason: "anti_cheat",
    explanation: explain("penalty.anti_cheat", "anti-cheat penalty applied", { scoreDelta, amount }),
  };
}

export function manualPenalty(amount: number, note: string): PenaltyDecision {
  const normalized = Math.abs(amount);
  return {
    amount: normalized,
    reason: "manual",
    explanation: explain("penalty.manual", note, { amount: normalized }),
  };
}
