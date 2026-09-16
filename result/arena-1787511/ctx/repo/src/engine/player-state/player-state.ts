import { NotFoundError } from "../../errors.js";
import type { EpochMillis } from "../../clock.js";
import { explain } from "../../explain.js";
import type { PlayerId, PlayerRecord, ScoreRecord, TournamentId } from "../../types.js";
import {
  appendHistory,
  emptyProfile,
  withMatchOutcome,
  type PlayerHistoryEntry,
  type PlayerProfile,
} from "../../domain/players/profile.js";
import type { ArenaState } from "../../events/replay/state.js";

export interface PlayerStateView {
  readonly player: PlayerRecord;
  readonly profile: PlayerProfile;
  readonly scores: readonly ScoreRecord[];
}

export class PlayerStateEngine {
  view(state: ArenaState, playerId: PlayerId): PlayerStateView {
    const player = state.players.get(playerId);
    if (!player) {
      throw new NotFoundError("player", playerId);
    }
    const scores = [...state.scores.values()].filter((score) => score.playerId === playerId);
    let profile = emptyProfile(player);
    for (const score of scores) {
      profile = Object.freeze({
        ...profile,
        tournamentsPlayed: profile.tournamentsPlayed + 1,
        matchesPlayed: profile.matchesPlayed + score.wins + score.losses + score.draws,
        wins: profile.wins + score.wins,
        losses: profile.losses + score.losses,
        draws: profile.draws + score.draws,
        totalScore: profile.totalScore + score.total,
        currentStreak: score.streak,
        bestStreak: Math.max(profile.bestStreak, score.bestStreak),
        lastActiveAt: score.lastUpdatedAt,
      });
    }
    const history = this.historyFromState(state, playerId);
    return {
      player,
      profile: Object.freeze({ ...profile, history }),
      scores,
    };
  }

  historyFromState(state: ArenaState, playerId: PlayerId): readonly PlayerHistoryEntry[] {
    const entries: PlayerHistoryEntry[] = [];
    for (const tournament of state.tournaments.values()) {
      if (tournament.registeredPlayerIds.includes(playerId)) {
        entries.push({
          at: tournament.createdAt,
          kind: "registration",
          summary: `registered in ${tournament.id}`,
          explanation: explain("player.registered", "player registered", {
            playerId,
            tournamentId: tournament.id,
          }),
          payload: { tournamentId: tournament.id },
        });
      }
    }
    for (const reward of state.rewards.values()) {
      if (reward.playerId === playerId) {
        entries.push({
          at: reward.grantedAt,
          kind: "reward",
          summary: `reward ${reward.status} ${reward.amount}`,
          explanation: reward.explanation,
          payload: { rewardId: reward.id, status: reward.status },
        });
      }
    }
    return Object.freeze(entries.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind)));
  }

  recordOutcome(
    profile: PlayerProfile,
    outcome: "win" | "loss" | "draw" | "forfeit",
    at: EpochMillis,
    tournamentId: TournamentId,
  ): PlayerProfile {
    const next = withMatchOutcome(profile, outcome, at);
    return appendHistory(next, {
      at,
      kind: "match",
      summary: `${outcome} in ${tournamentId}`,
      explanation: explain("player.outcome", `recorded ${outcome}`, { tournamentId, outcome }),
      payload: { tournamentId, outcome },
    });
  }

  listByActivity(state: ArenaState): PlayerStateView[] {
    return [...state.players.keys()]
      .map((playerId) => this.view(state, playerId))
      .sort((a, b) => {
        const aAt = a.profile.lastActiveAt ?? a.player.createdAt;
        const bAt = b.profile.lastActiveAt ?? b.player.createdAt;
        if (aAt !== bAt) {
          return bAt - aAt;
        }
        return a.player.id < b.player.id ? -1 : 1;
      });
  }
}

export const playerStateEngine = new PlayerStateEngine();
