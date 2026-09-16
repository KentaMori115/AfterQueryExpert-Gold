import { explain, type DecisionExplanation } from "../../explain.js";
import type { AntiCheatSeverity, MatchRecord, ScoreRecord } from "../../types.js";

export interface AntiCheatFinding {
  readonly code: string;
  readonly severity: AntiCheatSeverity;
  readonly explanation: DecisionExplanation;
}

export function impossibleScoreChange(
  previous: ScoreRecord | undefined,
  awarded: number,
  maxAbs = 500,
): AntiCheatFinding | undefined {
  if (Math.abs(awarded) <= maxAbs) {
    return undefined;
  }
  return {
    code: "impossible_score_change",
    severity: "block",
    explanation: explain("anticheat.impossible_score_change", "awarded points exceed configured bound", {
      awarded,
      maxAbs,
      previous: previous?.total,
    }),
  };
}

export function duplicateSubmission(
  seenKeys: ReadonlySet<string>,
  key: string,
): AntiCheatFinding | undefined {
  if (!seenKeys.has(key)) {
    return undefined;
  }
  return {
    code: "duplicate_submission",
    severity: "block",
    explanation: explain("anticheat.duplicate_submission", "identical match result was already recorded", {
      key,
    }),
  };
}

export function invalidMatchSequence(match: MatchRecord, action: "start" | "complete"): AntiCheatFinding | undefined {
  if (action === "start" && match.status !== "pending") {
    return {
      code: "invalid_match_sequence",
      severity: "block",
      explanation: explain("anticheat.invalid_match_sequence", "match cannot be started from current status", {
        matchId: match.id,
        status: match.status,
        action,
      }),
    };
  }
  if (action === "complete" && match.status !== "started") {
    return {
      code: "invalid_match_sequence",
      severity: "block",
      explanation: explain("anticheat.invalid_match_sequence", "match cannot be completed from current status", {
        matchId: match.id,
        status: match.status,
        action,
      }),
    };
  }
  return undefined;
}

export function repeatedOpponent(
  previousOpponents: readonly string[],
  opponentId: string,
  limit = 3,
): AntiCheatFinding | undefined {
  const repeats = previousOpponents.filter((id) => id === opponentId).length;
  if (repeats < limit) {
    return undefined;
  }
  return {
    code: "abnormal_behavior",
    severity: "warning",
    explanation: explain("anticheat.repeated_opponent", "same opponent faced too often", {
      opponentId,
      repeats,
      limit,
    }),
  };
}

export function zeroTimeCompletion(startedAt: number | undefined, completedAt: number): AntiCheatFinding | undefined {
  if (startedAt === undefined || completedAt > startedAt) {
    return undefined;
  }
  return {
    code: "invalid_match_sequence",
    severity: "block",
    explanation: explain("anticheat.zero_time", "match completed at or before start time", {
      startedAt,
      completedAt,
    }),
  };
}

export function duplicateEventId(seenIds: ReadonlySet<string>, eventId: string): AntiCheatFinding | undefined {
  if (!seenIds.has(eventId)) {
    return undefined;
  }
  return {
    code: "duplicate_submission",
    severity: "block",
    explanation: explain("anticheat.duplicate_event", "event id was already accepted", { eventId }),
  };
}

export function abnormalWinRate(wins: number, matches: number, threshold = 0.98, minMatches = 8): AntiCheatFinding | undefined {
  if (matches < minMatches) {
    return undefined;
  }
  const rate = wins / matches;
  if (rate < threshold) {
    return undefined;
  }
  return {
    code: "abnormal_behavior",
    severity: "warning",
    explanation: explain("anticheat.abnormal_behavior", "win rate is statistically extreme", {
      wins,
      matches,
      rate,
      threshold,
    }),
  };
}
