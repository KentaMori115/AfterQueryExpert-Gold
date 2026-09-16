import { InvalidArgumentError } from "../../errors.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type { PlayerRecord } from "../../types.js";
import { pairClosest, snakeDraft, type TeamAssignment } from "./balancing.js";
import { inSkillBand, skillDistance } from "./skill.js";

export interface MatchProposal {
  readonly playerIds: readonly string[];
  readonly averageSkill: number;
  readonly skillRange: number;
  readonly explanation: DecisionExplanation;
}

export class MatchmakingEngine {
  proposePairs(players: readonly PlayerRecord[], maxSkillGap = 400): MatchProposal[] {
    if (players.length < 2) {
      throw new InvalidArgumentError("matchmaking requires at least two players");
    }
    return pairClosest(players)
      .filter(([a, b]) => skillDistance(a, b) <= maxSkillGap)
      .map(([a, b]) => {
        const averageSkill = (a.skillRating + b.skillRating) / 2;
        const skillRange = skillDistance(a, b);
        return {
          playerIds: [a.id, b.id],
          averageSkill,
          skillRange,
          explanation: explain("matchmaking.pair", `paired ${a.id} with ${b.id}`, {
            averageSkill,
            skillRange,
            inBand: inSkillBand(a, b),
          }),
        };
      });
  }

  proposeTeams(players: readonly PlayerRecord[], teamCount = 2): TeamAssignment[] {
    if (teamCount < 2) {
      throw new InvalidArgumentError("teamCount must be at least 2", { teamCount });
    }
    return snakeDraft(players, teamCount);
  }
}

export const matchmakingEngine = new MatchmakingEngine();
