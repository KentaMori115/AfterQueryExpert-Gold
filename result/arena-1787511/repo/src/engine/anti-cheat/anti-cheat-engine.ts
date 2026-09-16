import { AntiCheatError } from "../../errors.js";
import type { MatchRecord, ScoreRecord } from "../../types.js";
import {
  abnormalWinRate,
  duplicateEventId,
  duplicateSubmission,
  impossibleScoreChange,
  invalidMatchSequence,
  zeroTimeCompletion,
  type AntiCheatFinding,
} from "./detectors.js";

export interface SubmissionGuardInput {
  readonly match: MatchRecord;
  readonly awarded: number;
  readonly previousScore?: ScoreRecord;
  readonly submissionKey: string;
  readonly seenKeys: ReadonlySet<string>;
  readonly wins?: number;
  readonly matchesPlayed?: number;
  readonly completedAt?: number;
  readonly eventId?: string;
  readonly seenEventIds?: ReadonlySet<string>;
}

export class AntiCheatEngine {
  inspect(input: SubmissionGuardInput): AntiCheatFinding[] {
    const findings = [
      impossibleScoreChange(input.previousScore, input.awarded),
      duplicateSubmission(input.seenKeys, input.submissionKey),
      invalidMatchSequence(input.match, "complete"),
      abnormalWinRate(input.wins ?? 0, input.matchesPlayed ?? 0),
      input.completedAt !== undefined
        ? zeroTimeCompletion(input.match.startedAt, input.completedAt)
        : undefined,
      input.eventId && input.seenEventIds
        ? duplicateEventId(input.seenEventIds, input.eventId)
        : undefined,
    ].filter((finding): finding is AntiCheatFinding => finding !== undefined);
    return findings;
  }

  assertClean(input: SubmissionGuardInput): AntiCheatFinding[] {
    const findings = this.inspect(input);
    const blocked = findings.filter((finding) => finding.severity === "block");
    if (blocked.length > 0) {
      throw new AntiCheatError("submission blocked by anti-cheat rules", {
        codes: blocked.map((finding) => finding.code),
        findings: blocked.map((finding) => finding.explanation),
      });
    }
    return findings;
  }

  submissionKey(matchId: string, playerId: string, rawScore: number, outcome: string): string {
    return `${matchId}:${playerId}:${outcome}:${rawScore}`;
  }
}

export const antiCheatEngine = new AntiCheatEngine();
