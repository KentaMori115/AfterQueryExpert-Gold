import type { TournamentRecord } from "../types.js";
import type { ArenaFlowClient } from "./client.js";

export class TournamentApi {
  constructor(private readonly client: ArenaFlowClient) {}

  create(body: Record<string, unknown>): Promise<TournamentRecord> {
    return this.client.request("POST", "/tournaments", body);
  }

  get(id: string): Promise<TournamentRecord> {
    return this.client.request("GET", `/tournaments/${id}`);
  }

  open(id: string, at: number): Promise<TournamentRecord> {
    return this.client.request("POST", `/tournaments/${id}/open`, { at });
  }

  register(id: string, playerId: string, at: number): Promise<TournamentRecord> {
    return this.client.request("POST", `/tournaments/${id}/register`, { playerId, at });
  }

  start(id: string, at: number): Promise<TournamentRecord> {
    return this.client.request("POST", `/tournaments/${id}/start`, { at });
  }

  end(id: string, at: number): Promise<TournamentRecord> {
    return this.client.request("POST", `/tournaments/${id}/end`, { at });
  }
}
