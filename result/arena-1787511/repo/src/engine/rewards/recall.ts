import { ConflictError, InvalidArgumentError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type { RewardId, RewardRecord, TournamentId } from "../../types.js";

/**
 * Distribution rounds. A tournament pays out once, and if the standings it
 * paid against turn out to be wrong the whole payout is taken back and a new
 * round is paid. Rounds are written into the reward id so the earlier round
 * keeps its own records instead of being overwritten by the later one.
 */
export const FIRST_ROUND = 1;

const ROUND_SUFFIX = /_r([0-9]+)$/;

export function roundSuffix(round: number): string {
  if (!Number.isInteger(round) || round < FIRST_ROUND) {
    throw new InvalidArgumentError("a distribution round starts at one", { round });
  }
  return round === FIRST_ROUND ? "" : `_r${round}`;
}

/** The round a reward id belongs to. An id with no suffix is the first. */
export function roundOf(rewardId: RewardId): number {
  const match = ROUND_SUFFIX.exec(rewardId);
  if (!match) {
    return FIRST_ROUND;
  }
  const round = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(round) && round >= FIRST_ROUND ? round : FIRST_ROUND;
}

/** The round the next distribution for this tournament writes. */
export function nextRound(tournamentId: TournamentId, rewards: readonly RewardRecord[]): number {
  const mine = rewards.filter((reward) => reward.tournamentId === tournamentId);
  if (mine.length === 0) {
    return FIRST_ROUND;
  }
  return mine.reduce((highest, reward) => Math.max(highest, roundOf(reward.id)), FIRST_ROUND) + 1;
}

export interface RecallPlan {
  readonly tournamentId: TournamentId;
  readonly revoking: readonly RewardRecord[];
  readonly claimed: readonly RewardRecord[];
  readonly round: number;
  readonly explanation: DecisionExplanation;
}

/**
 * What a recall would do. Rewards already revoked are left alone, and a
 * reward somebody has claimed is a blocker rather than something to take
 * back: the prize has left the arena and the ledger has to say so.
 */
export function planRecall(
  tournamentId: TournamentId,
  rewards: readonly RewardRecord[],
  at: EpochMillis,
): RecallPlan {
  const mine = [...rewards]
    .filter((reward) => reward.tournamentId === tournamentId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const revoking = mine.filter((reward) => reward.status === "granted");
  const claimed = mine.filter((reward) => reward.status === "claimed");
  return {
    tournamentId,
    revoking: Object.freeze(revoking),
    claimed: Object.freeze(claimed),
    round: nextRound(tournamentId, rewards),
    explanation: explain("reward.recalled", `recalling ${revoking.length} rewards`, {
      tournamentId,
      recalling: revoking.length,
      blocked: claimed.length,
      round: nextRound(tournamentId, rewards),
      at,
    }),
  };
}

export function assertRecallable(plan: RecallPlan): RecallPlan {
  if (plan.claimed.length > 0) {
    throw new ConflictError("a claimed reward cannot be recalled", {
      tournamentId: plan.tournamentId,
      claimed: plan.claimed.map((reward) => reward.id),
    });
  }
  return plan;
}

/**
 * The rewards a tournament can no longer pay: granted, and past the deadline
 * their config gave them. A window nobody set never closes.
 */
export function expiredRewards(
  tournamentId: TournamentId,
  rewards: readonly RewardRecord[],
  at: EpochMillis,
  claimWindowMs?: number,
): RewardRecord[] {
  if (claimWindowMs === undefined) {
    return [];
  }
  return [...rewards]
    .filter(
      (reward) =>
        reward.tournamentId === tournamentId &&
        reward.status === "granted" &&
        at > reward.grantedAt + claimWindowMs,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function recallReason(reason: string): string {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) {
    throw new InvalidArgumentError("a recall needs a reason", { reason });
  }
  return trimmed;
}
