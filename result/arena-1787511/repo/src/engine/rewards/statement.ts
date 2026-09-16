import type { EpochMillis } from "../../clock.js";
import { explain, type DecisionExplanation } from "../../explain.js";
import type { RewardRecord, TournamentId } from "../../types.js";
import { roundOf } from "./recall.js";

/**
 * One distribution round of a tournament's payout. `granted` is what the
 * round handed out when it ran; `standing` is what survived, so a recalled
 * round shows what it once was next to nothing at all.
 */
export interface PayoutRound {
  readonly round: number;
  readonly grantedAt: EpochMillis;
  readonly rewards: readonly RewardRecord[];
  readonly granted: number;
  readonly standing: number;
}

export interface PayoutStatement {
  readonly tournamentId: TournamentId;
  readonly rounds: readonly PayoutRound[];
  readonly recalled: number;
  readonly outstanding: number;
  readonly paid: number;
  readonly explanation: DecisionExplanation;
}

function sum(rewards: readonly RewardRecord[]): number {
  return rewards.reduce((total, reward) => total + reward.amount, 0);
}

/**
 * Everything a tournament has paid, taken back, and still owes, round by
 * round. Read out of the reward records themselves rather than kept beside
 * them, so a statement can never drift from the ledger it describes.
 */
export function payoutStatement(
  tournamentId: TournamentId,
  rewards: readonly RewardRecord[],
): PayoutStatement {
  const mine = [...rewards]
    .filter((reward) => reward.tournamentId === tournamentId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byRound = new Map<number, RewardRecord[]>();
  for (const reward of mine) {
    const round = roundOf(reward.id);
    byRound.set(round, [...(byRound.get(round) ?? []), reward]);
  }

  const rounds: PayoutRound[] = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, records]) => {
      const alive = records.filter((reward) => reward.status !== "revoked");
      return Object.freeze({
        round,
        grantedAt: records.reduce(
          (earliest, reward) => Math.min(earliest, reward.grantedAt),
          Number.MAX_SAFE_INTEGER,
        ),
        rewards: Object.freeze(records),
        granted: sum(records),
        standing: sum(alive),
      });
    });

  const recalled = sum(mine.filter((reward) => reward.status === "revoked"));
  const outstanding = sum(mine.filter((reward) => reward.status === "granted"));
  const paid = sum(mine.filter((reward) => reward.status === "claimed"));

  return {
    tournamentId,
    rounds: Object.freeze(rounds),
    recalled,
    outstanding,
    paid,
    explanation: explain("reward.statement", `${rounds.length} rounds for ${tournamentId}`, {
      tournamentId,
      rounds: rounds.length,
      recalled,
      outstanding,
      paid,
    }),
  };
}

/** The rounds a tournament has run, oldest first. */
export function roundNumbers(statement: PayoutStatement): number[] {
  return statement.rounds.map((round) => round.round);
}

/** What a round would have paid one player, whether or not it still stands. */
export function roundShare(round: PayoutRound, playerId: string): number {
  return sum(round.rewards.filter((reward) => reward.playerId === playerId));
}
