import type { EpochMillis } from "../../clock.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type {
  MatchOutcome,
  PlayerRecord,
  ScoreRecord,
  ScoringConfig,
  TournamentRecord,
} from "../../types.js";
import {
  applyScoreDelta,
  applyVipMultiplier,
  basePointsFor,
  emptyScore,
  evaluateCustomFormula,
  streakBonus,
} from "../../domain/scores/index.js";

export interface ScoreSubmission {
  readonly player: PlayerRecord;
  readonly tournament: TournamentRecord;
  readonly current: ScoreRecord | undefined;
  readonly outcome: MatchOutcome;
  readonly rawScore: number;
  readonly at: EpochMillis;
}

export interface ScoreDecision {
  readonly next: ScoreRecord;
  readonly awarded: number;
  readonly breakdown: ScoreBreakdown;
  readonly explanation: DecisionExplanation;
}

export interface ScoreBreakdown {
  readonly base: number;
  readonly streak: number;
  readonly vipAdjusted: number;
  readonly custom: number | undefined;
  readonly penalty: number;
  readonly awarded: number;
}

export class ScoringEngine {
  decide(submission: ScoreSubmission, extraPenalty = 0): ScoreDecision {
    const config = submission.tournament.scoring;
    const current =
      submission.current ?? emptyScore(submission.player.id, submission.tournament.id, submission.at);
    const prospectiveStreak = submission.outcome === "win" ? current.streak + 1 : 0;
    const breakdown = this.breakdown(
      {
        outcome: submission.outcome,
        rawScore: submission.rawScore,
        streak: prospectiveStreak,
        vip: submission.player.vip,
        config,
      },
      extraPenalty,
    );
    const explanation = explain(
      "score.awarded",
      `awarded ${breakdown.awarded} for ${submission.outcome}`,
      {
        playerId: submission.player.id,
        tournamentId: submission.tournament.id,
        outcome: submission.outcome,
        ...breakdown,
      },
    );
    return {
      next: applyScoreDelta(current, breakdown.awarded, submission.at, explanation, submission.outcome),
      awarded: breakdown.awarded,
      breakdown,
      explanation,
    };
  }

  breakdown(
    context: {
      outcome: MatchOutcome;
      rawScore: number;
      streak: number;
      vip: boolean;
      config: ScoringConfig;
    },
    extraPenalty = 0,
  ): ScoreBreakdown {
    const base = basePointsFor(context.outcome, context.config);
    const streak = context.outcome === "win" ? streakBonus(context.streak, context.config) : 0;
    const beforeVip = base + streak;
    const vipAdjusted = applyVipMultiplier(beforeVip, context.vip, context.config);
    const custom = context.config.customFormula
      ? evaluateCustomFormula(context.config.customFormula, context)
      : undefined;
    const rawAwarded = custom ?? vipAdjusted;
    const penalty = Math.abs(extraPenalty);
    const awarded = rawAwarded - penalty;
    return { base, streak, vipAdjusted, custom, penalty, awarded };
  }

  preview(config: ScoringConfig, outcome: MatchOutcome, streak: number, vip: boolean): number {
    return this.breakdown(
      { outcome, rawScore: 0, streak, vip, config },
      0,
    ).awarded;
  }
}

export const scoringEngine = new ScoringEngine();
