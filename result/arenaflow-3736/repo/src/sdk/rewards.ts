import type { RewardRecord } from "../types.js";
import type { ArenaFlowClient } from "./client.js";

export class RewardApi {
  constructor(private readonly client: ArenaFlowClient) {}

  distribute(tournamentId: string, at: number): Promise<RewardRecord[]> {
    return this.client.request("POST", "/rewards/distribute", { tournamentId, at });
  }

  forPlayer(playerId: string): Promise<{ playerId: string; rewards: RewardRecord[] }> {
    return this.client.request("GET", `/rewards/${playerId}`);
  }
}
