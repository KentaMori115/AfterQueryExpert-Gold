export const EXPLANATION_CODES = {
  SCORE_AWARDED: "score.awarded",
  RANK_COMPUTED: "rank.computed",
  REWARD_QUALIFIED: "reward.qualified",
  REWARD_GRANTED: "reward.granted",
  REWARD_CLAIMED: "reward.claimed",
  REWARD_REVOKED: "reward.revoked",
  RULE_PASS_MIN_LEVEL: "rule.pass.min_level",
  RULE_FAIL_MIN_LEVEL: "rule.fail.min_level",
  RULE_PASS_VIP: "rule.pass.vip",
  RULE_FAIL_VIP: "rule.fail.vip",
  BONUS_STREAK: "bonus.streak",
  BONUS_VIP: "bonus.vip",
  PENALTY_FORFEIT: "penalty.forfeit",
  PENALTY_ANTI_CHEAT: "penalty.anti_cheat",
  MATCHMAKING_PAIR: "matchmaking.pair",
  SEASON_CLOSED: "season.closed",
  ANTICHEAT_IMPOSSIBLE: "anticheat.impossible_score_change",
  ANTICHEAT_DUPLICATE: "anticheat.duplicate_submission",
  ANTICHEAT_SEQUENCE: "anticheat.invalid_match_sequence",
} as const;

export type ExplanationCode = (typeof EXPLANATION_CODES)[keyof typeof EXPLANATION_CODES];

export function isKnownCode(code: string): boolean {
  return Object.values(EXPLANATION_CODES).includes(code as ExplanationCode);
}

export function codeFamily(code: string): string {
  const idx = code.indexOf(".");
  return idx === -1 ? code : code.slice(0, idx);
}
