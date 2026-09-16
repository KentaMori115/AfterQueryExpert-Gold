import { IllegalStateError, InvalidArgumentError, NotFoundError } from "../../errors.js";
import { explain } from "../../explain.js";
import type { EpochMillis } from "../../clock.js";
import { eventExplanation, type AppendEventInput } from "../../events/journal/journal.js";
import type { DomainEventType } from "../../events/types.js";
import { scoreKey } from "../../events/replay/state.js";
import type { MemoryPersistence } from "../../persistence/memory/memory-store.js";
import type { PersistenceAdapter } from "../../persistence/types.js";
import {
  DEFAULT_REWARDS,
  DEFAULT_RULES,
  DEFAULT_SCORING,
  type MatchOutcome,
  type PlayerId,
  type PlayerRecord,
  type RewardRecord,
  type TournamentFormat,
  type TournamentId,
  type TournamentRecord,
} from "../../types.js";
import { createPlayer, type CreatePlayerInput } from "../../domain/players/player.js";
import {
  cancelTournament,
  createTournament,
  endTournament,
  openRegistration,
  registerPlayer,
  startTournament,
  type CreateTournamentInput,
} from "../../domain/tournaments/index.js";
import { completeMatch, createMatch, startMatch } from "../../domain/matches/match.js";
import { pairResult } from "../../domain/matches/result.js";
import { playerStateEngine } from "../player-state/player-state.js";
import { scoringEngine } from "../scoring/scoring-engine.js";
import { rankingEngine } from "../ranking/ranking-engine.js";
import { ruleEngine } from "../rules/rule-engine.js";
import { rewardEngine } from "../rewards/reward-engine.js";
import { rewardBalance, type RewardBalance } from "../rewards/claims.js";
import {
  assertRecallable,
  expiredRewards,
  nextRound,
  planRecall,
  recallReason,
} from "../rewards/recall.js";
import { payoutStatement, type PayoutStatement } from "../rewards/statement.js";
import { antiCheatEngine } from "../anti-cheat/anti-cheat-engine.js";

export type ArenaStore = PersistenceAdapter & Partial<Pick<MemoryPersistence, "current" | "requirePlayer" | "requireTournament">>;

export class TournamentService {
  private readonly seenKeys = new Set<string>();

  constructor(private readonly store: ArenaStore) {}

  createPlayer(input: CreatePlayerInput): PlayerRecord {
    const player = createPlayer(input);
    this.store.savePlayer(player);
    this.record({
      type: "PlayerCreated",
      at: input.createdAt,
      streamId: `player:${player.id}`,
      payload: {
        playerId: player.id,
        displayName: player.displayName,
        skillRating: player.skillRating,
        level: player.level,
        vip: player.vip,
      },
      explanation: eventExplanation("PlayerCreated", `created ${player.id}`),
    });
    return player;
  }

  createTournament(input: CreateTournamentInput): TournamentRecord {
    const tournament = createTournament({
      ...input,
      scoring: { ...DEFAULT_SCORING, ...input.scoring },
      rules: { ...DEFAULT_RULES, ...input.rules },
      rewards: { ...DEFAULT_REWARDS, ...input.rewards },
    });
    this.store.saveTournament(tournament);
    this.record({
      type: "TournamentCreated",
      at: input.createdAt,
      streamId: `tournament:${tournament.id}`,
      payload: {
        tournamentId: tournament.id,
        name: tournament.name,
        format: tournament.format,
        ...(tournament.seasonId ? { seasonId: tournament.seasonId } : {}),
      },
      explanation: eventExplanation("TournamentCreated", `created ${tournament.id}`),
    });
    return tournament;
  }

  openRegistration(tournamentId: TournamentId, at: EpochMillis): TournamentRecord {
    const opened = openRegistration(this.requireTournament(tournamentId), at);
    this.store.saveTournament(opened);
    this.record({
      type: "TournamentOpened",
      at,
      streamId: `tournament:${tournamentId}`,
      payload: { tournamentId },
      explanation: eventExplanation("TournamentOpened", `opened ${tournamentId}`),
    });
    return opened;
  }

  register(tournamentId: TournamentId, playerId: PlayerId, at: EpochMillis): TournamentRecord {
    const tournament = this.requireTournament(tournamentId);
    const player = this.requirePlayer(playerId);
    ruleEngine.assertEligible(player, tournament);
    const next = registerPlayer(tournament, player);
    this.store.saveTournament(next);
    this.record({
      type: "PlayerRegistered",
      at,
      streamId: `tournament:${tournamentId}`,
      payload: { playerId, tournamentId },
      explanation: eventExplanation("PlayerRegistered", `registered ${playerId}`),
    });
    return next;
  }

  start(tournamentId: TournamentId, at: EpochMillis): TournamentRecord {
    const started = startTournament(this.requireTournament(tournamentId), at);
    this.store.saveTournament(started);
    this.record({
      type: "TournamentStarted",
      at,
      streamId: `tournament:${tournamentId}`,
      payload: { tournamentId },
      explanation: eventExplanation("TournamentStarted", `started ${tournamentId}`),
    });
    return started;
  }

  end(tournamentId: TournamentId, at: EpochMillis): TournamentRecord {
    const ended = endTournament(this.requireTournament(tournamentId), at);
    this.store.saveTournament(ended);
    this.record({
      type: "TournamentEnded",
      at,
      streamId: `tournament:${tournamentId}`,
      payload: { tournamentId },
      explanation: eventExplanation("TournamentEnded", `ended ${tournamentId}`),
    });
    return ended;
  }

  cancel(tournamentId: TournamentId, at: EpochMillis, reason: string): TournamentRecord {
    const cancelled = cancelTournament(this.requireTournament(tournamentId), at);
    this.store.saveTournament(cancelled);
    this.record({
      type: "TournamentCancelled",
      at,
      streamId: `tournament:${tournamentId}`,
      payload: { tournamentId, reason },
      explanation: eventExplanation("TournamentCancelled", reason),
    });
    return cancelled;
  }

  createMatch(input: {
    id: string;
    tournamentId: TournamentId;
    playerIds: readonly PlayerId[];
    createdAt: EpochMillis;
  }) {
    const tournament = this.requireTournament(input.tournamentId);
    if (tournament.status !== "active") {
      throw new IllegalStateError("matches can only be created for active tournaments", {
        tournamentId: tournament.id,
        status: tournament.status,
      });
    }
    for (const playerId of input.playerIds) {
      if (!tournament.registeredPlayerIds.includes(playerId)) {
        throw new InvalidArgumentError("match player is not registered", { playerId });
      }
    }
    const match = createMatch(input);
    this.store.saveMatch(match);
    this.record({
      type: "MatchCreated",
      at: input.createdAt,
      streamId: `match:${match.id}`,
      payload: { matchId: match.id, tournamentId: match.tournamentId, playerIds: match.playerIds },
      explanation: eventExplanation("MatchCreated", `created ${match.id}`),
    });
    return match;
  }

  startMatch(matchId: string, at: EpochMillis) {
    const match = this.requireMatch(matchId);
    const started = startMatch(match, at);
    this.store.saveMatch(started);
    this.record({
      type: "MatchStarted",
      at,
      streamId: `match:${matchId}`,
      payload: { matchId, tournamentId: started.tournamentId },
      explanation: eventExplanation("MatchStarted", `started ${matchId}`),
    });
    return started;
  }

  submitPairResult(input: {
    matchId: string;
    winnerId: PlayerId;
    loserId: PlayerId;
    at: EpochMillis;
    winnerScore?: number;
    loserScore?: number;
  }) {
    const match = this.requireMatch(input.matchId);
    const tournament = this.requireTournament(match.tournamentId);
    const results = pairResult({
      winnerId: input.winnerId,
      loserId: input.loserId,
      winnerScore: input.winnerScore ?? 1,
      loserScore: input.loserScore ?? 0,
    });
    for (const result of results) {
      this.applyScore(tournament, match.id, result.playerId, result.outcome, result.rawScore, input.at);
    }
    const completed = completeMatch(match, results, input.at);
    this.store.saveMatch(completed);
    this.record({
      type: "MatchCompleted",
      at: input.at,
      streamId: `match:${match.id}`,
      payload: { matchId: match.id, tournamentId: tournament.id },
      explanation: eventExplanation("MatchCompleted", `completed ${match.id}`),
    });
    return completed;
  }

  leaderboard(tournamentId: TournamentId) {
    return rankingEngine.leaderboard(tournamentId, this.store.listScores(tournamentId));
  }

  rankingsFor(playerId: PlayerId) {
    const scores = [...this.currentScores()].filter((score) => score.playerId === playerId);
    return scores.map((score) => rankingEngine.compute(score.tournamentId, this.store.listScores(score.tournamentId)))
      .flatMap((computation) => computation.entries.filter((entry) => entry.playerId === playerId));
  }

  distributeRewards(tournamentId: TournamentId, at: EpochMillis): RewardRecord[] {
    const tournament = this.requireTournament(tournamentId);
    if (tournament.status !== "completed") {
      throw new IllegalStateError("rewards can only be distributed after a tournament ends", {
        tournamentId,
        status: tournament.status,
      });
    }
    const entries = rankingEngine.compute(tournamentId, this.store.listScores(tournamentId)).entries;
    const ledger = this.store.listRewards();
    const rewards = rewardEngine.qualify(
      tournamentId,
      entries,
      tournament.rewards,
      at,
      ledger,
      nextRound(tournamentId, ledger),
    );
    for (const reward of rewards) {
      this.store.saveReward(reward);
      this.record({
        type: "RewardGranted",
        at,
        streamId: `reward:${reward.id}`,
        payload: {
          rewardId: reward.id,
          playerId: reward.playerId,
          tournamentId,
          amount: reward.amount,
          tier: reward.tier,
        },
        explanation: reward.explanation,
      });
    }
    return rewards;
  }

  /**
   * Take one reward back and say why. The event goes on the reward's own
   * stream, so the record and the reason travel together.
   */
  revokeReward(rewardId: string, at: EpochMillis, reason: string): RewardRecord {
    const why = recallReason(reason);
    const revoked = rewardEngine.revoke(this.store.listRewards(), rewardId, why);
    this.store.saveReward(revoked);
    this.record({
      type: "RewardRevoked",
      at,
      streamId: `reward:${revoked.id}`,
      payload: { rewardId: revoked.id, playerId: revoked.playerId, reason: why },
      explanation: explain("reward.revoked", why, {
        rewardId: revoked.id,
        tournamentId: revoked.tournamentId,
        amount: revoked.amount,
      }),
    });
    return revoked;
  }

  /**
   * Take a whole payout back so the tournament can be paid again. Nothing is
   * taken back at all when one of its rewards has been claimed.
   */
  recallRewards(tournamentId: TournamentId, at: EpochMillis, reason: string): RewardRecord[] {
    this.requireTournament(tournamentId);
    const why = recallReason(reason);
    const plan = assertRecallable(planRecall(tournamentId, this.store.listRewards(), at));
    return plan.revoking.map((reward) => this.revokeReward(reward.id, at, why));
  }

  /**
   * Close out the rewards nobody came for. A window that has run out leaves a
   * reward that can never be claimed, so it is taken back rather than left
   * sitting in a player's balance forever.
   */
  expireClaims(tournamentId: TournamentId, at: EpochMillis): RewardRecord[] {
    const tournament = this.requireTournament(tournamentId);
    const stale = expiredRewards(
      tournamentId,
      this.store.listRewards(),
      at,
      tournament.rewards.claimWindowMs,
    );
    return stale.map((reward) => this.revokeReward(reward.id, at, "claim window closed"));
  }

  /** Every payout round a tournament has run, and what each one left behind. */
  payoutStatement(tournamentId: TournamentId): PayoutStatement {
    this.requireTournament(tournamentId);
    return payoutStatement(tournamentId, this.store.listRewards());
  }

  rewardBalance(playerId: PlayerId): RewardBalance {
    this.requirePlayer(playerId);
    return rewardBalance(this.store.listRewards(), playerId);
  }

  claimReward(rewardId: string, at: EpochMillis): RewardRecord {
    const ledger = this.store.listRewards();
    const existing = ledger.find((reward) => reward.id === rewardId);
    if (!existing) {
      throw new NotFoundError("reward", rewardId);
    }
    const tournament = this.requireTournament(existing.tournamentId);
    const updated = rewardEngine.claim(
      ledger,
      rewardId,
      at,
      tournament.rewards.claimWindowMs,
    );
    const claimed = updated.find((reward) => reward.id === rewardId);
    if (!claimed) {
      throw new NotFoundError("reward", rewardId);
    }
    this.store.saveReward(claimed);
    this.record({
      type: "RewardClaimed",
      at,
      streamId: `reward:${rewardId}`,
      payload: { rewardId, playerId: claimed.playerId },
      explanation: eventExplanation("RewardClaimed", `claimed ${rewardId}`),
    });
    return claimed;
  }

  profile(playerId: PlayerId) {
    return playerStateEngine.view(this.state(), playerId);
  }

  getPlayer(playerId: PlayerId): PlayerRecord {
    return this.requirePlayer(playerId);
  }

  getTournament(tournamentId: TournamentId): TournamentRecord {
    return this.requireTournament(tournamentId);
  }

  listTournaments(): TournamentRecord[] {
    return this.store.listTournaments();
  }

  listRewards(playerId?: PlayerId): RewardRecord[] {
    return this.store.listRewards(playerId);
  }

  supportedFormats(): readonly TournamentFormat[] {
    return ["leaderboard", "round_robin", "elimination", "team", "time_challenge"];
  }

  private applyScore(
    tournament: TournamentRecord,
    matchId: string,
    playerId: PlayerId,
    outcome: MatchOutcome,
    rawScore: number,
    at: EpochMillis,
  ): void {
    const player = this.requirePlayer(playerId);
    const previous = this.store.listScores(tournament.id).find((score) => score.playerId === playerId);
    const decision = scoringEngine.decide({
      player,
      tournament,
      current: previous,
      outcome,
      rawScore,
      at,
    });
    const match = this.requireMatch(matchId);
    const key = antiCheatEngine.submissionKey(matchId, playerId, rawScore, outcome);
    antiCheatEngine.assertClean({
      match,
      awarded: decision.awarded,
      ...(previous ? { previousScore: previous } : {}),
      submissionKey: key,
      seenKeys: this.seenKeys,
      wins: (previous?.wins ?? 0) + (outcome === "win" ? 1 : 0),
      matchesPlayed: (previous?.wins ?? 0) + (previous?.losses ?? 0) + (previous?.draws ?? 0) + 1,
    });
    this.seenKeys.add(key);
    this.store.saveScore(decision.next);
    this.record({
      type: "ScoreSubmitted",
      at,
      streamId: `match:${matchId}`,
      payload: {
        matchId,
        tournamentId: tournament.id,
        playerId,
        outcome,
        rawScore,
        awarded: decision.awarded,
      },
      explanation: decision.explanation,
    });
  }

  private record<T extends DomainEventType>(input: AppendEventInput<T>): void {
    this.store.journal.append(input);
    const current = this.state();
    this.store.replaceState({ ...current, lastSequence: this.store.journal.lastSequence() });
  }

  private state() {
    if (this.store.current) {
      return this.store.current();
    }
    return this.store.load();
  }

  private currentScores() {
    return this.state().scores.values();
  }

  private requirePlayer(id: PlayerId): PlayerRecord {
    if (this.store.requirePlayer) {
      return this.store.requirePlayer(id);
    }
    const player = this.store.getPlayer(id);
    if (!player) {
      throw new NotFoundError("player", id);
    }
    return player;
  }

  private requireTournament(id: TournamentId): TournamentRecord {
    if (this.store.requireTournament) {
      return this.store.requireTournament(id);
    }
    const tournament = this.store.getTournament(id);
    if (!tournament) {
      throw new NotFoundError("tournament", id);
    }
    return tournament;
  }

  private requireMatch(id: string) {
    const match = this.store.getMatch(id);
    if (!match) {
      throw new NotFoundError("match", id);
    }
    return match;
  }
}

export function scoreLookupKey(tournamentId: string, playerId: string): string {
  return scoreKey(tournamentId, playerId);
}
