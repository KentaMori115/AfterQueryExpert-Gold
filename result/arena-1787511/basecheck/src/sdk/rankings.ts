import type { Leaderboard } from "../domain/rankings/leaderboard.js";
import type { RankingEntry } from "../types.js";
import type { ArenaFlowClient } from "./client.js";

export class RankingApi {
  constructor(private readonly client: ArenaFlowClient) {}

  leaderboard(tournamentId: string): Promise<Leaderboard> {
    return this.client.request("GET", `/leaderboards/${tournamentId}`);
  }

  forPlayer(playerId: string): Promise<RankingEntry[]> {
    return this.client.request("GET", `/rankings/${playerId}`);
  }
}
