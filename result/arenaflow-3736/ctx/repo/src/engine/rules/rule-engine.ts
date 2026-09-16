import { IneligibleError } from "../../errors.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type { PlayerRecord, TournamentRecord } from "../../types.js";
import { composeModifiers, vipScoreModifier, type ScoreModifier } from "./modifiers.js";
import {
  DEFAULT_PREDICATES,
  allowedTagPredicate,
  bannedTagPredicate,
  matchLimitPredicate,
  maxLevelPredicate,
  minLevelPredicate,
  vipPredicate,
  type RuleContext,
} from "./predicates.js";

export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly DecisionExplanation[];
}

export class RuleEngine {
  evaluate(context: RuleContext): EligibilityDecision {
    const checks: Array<[string, boolean, string]> = [
      ["min_level", minLevelPredicate(context), "player meets minimum level"],
      ["max_level", maxLevelPredicate(context), "player meets maximum level"],
      ["vip", vipPredicate(context), "player satisfies vip requirement"],
      ["banned_tags", bannedTagPredicate(context), "player has no banned tags"],
      ["allowed_tags", allowedTagPredicate(context), "player has an allowed tag"],
      ["match_limit", matchLimitPredicate(context), "player is under the match limit"],
    ];
    const reasons = checks.map(([code, ok, message]) =>
      explain(ok ? `rule.pass.${code}` : `rule.fail.${code}`, message, {
        ok,
        playerId: context.player.id,
        tournamentId: context.tournament.id,
      }),
    );
    return {
      eligible: checks.every(([, ok]) => ok),
      reasons,
    };
  }

  assertEligible(player: PlayerRecord, tournament: TournamentRecord, matchesPlayed = 0): void {
    const decision = this.evaluate({ player, tournament, matchesPlayed });
    if (!decision.eligible) {
      throw new IneligibleError("player is not eligible for this tournament", {
        playerId: player.id,
        tournamentId: tournament.id,
        reasons: decision.reasons.filter((reason) => reason.code.startsWith("rule.fail")),
      });
    }
  }

  modifiers(player: PlayerRecord, tournament: TournamentRecord): ScoreModifier {
    return composeModifiers([vipScoreModifier(player, tournament.scoring)]);
  }

  allPredicates() {
    return DEFAULT_PREDICATES;
  }
}

export const ruleEngine = new RuleEngine();
