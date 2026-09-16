import type { RewardBalance } from "../engine/rewards/claims.js";
import type { PayoutStatement } from "../engine/rewards/statement.js";
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

  claim(rewardId: string, at: number): Promise<RewardRecord> {
    return this.client.request("POST", `/rewards/${rewardId}/claim`, { at });
  }

  revoke(rewardId: string, at: number, reason: string): Promise<RewardRecord> {
    return this.client.request("POST", `/rewards/${rewardId}/revoke`, { at, reason });
  }

  recall(tournamentId: string, at: number, reason: string): Promise<RewardRecord[]> {
    return this.client.request("POST", "/rewards/recall", { tournamentId, at, reason });
  }

  expire(tournamentId: string, at: number): Promise<RewardRecord[]> {
    return this.client.request("POST", "/rewards/expire", { tournamentId, at });
  }

  statement(tournamentId: string): Promise<PayoutStatement> {
    return this.client.request("GET", `/rewards/statement/${tournamentId}`);
  }

  balance(playerId: string): Promise<RewardBalance> {
    return this.client.request("GET", `/rewards/${playerId}/balance`);
  }
}
