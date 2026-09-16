import type { PlayerRecord } from "../types.js";
import type { PlayerStateView } from "../engine/player-state/player-state.js";
import type { ArenaFlowClient } from "./client.js";

export class PlayerApi {
  constructor(private readonly client: ArenaFlowClient) {}

  create(body: Record<string, unknown>): Promise<PlayerRecord> {
    return this.client.request("POST", "/players", body);
  }

  profile(id: string): Promise<PlayerStateView> {
    return this.client.request("GET", `/players/${id}/profile`);
  }

  history(id: string): Promise<{ playerId: string; history: unknown[] }> {
    return this.client.request("GET", `/players/${id}/history`);
  }
}
