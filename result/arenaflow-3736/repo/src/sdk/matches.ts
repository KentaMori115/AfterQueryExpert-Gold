import type { MatchRecord } from "../types.js";
import type { ArenaFlowClient } from "./client.js";

export class MatchApi {
  constructor(private readonly client: ArenaFlowClient) {}

  create(body: Record<string, unknown>): Promise<MatchRecord> {
    return this.client.request("POST", "/matches", body);
  }

  start(id: string, at: number): Promise<MatchRecord> {
    return this.client.request("POST", `/matches/${id}/start`, { at });
  }

  submitResult(id: string, body: Record<string, unknown>): Promise<MatchRecord> {
    return this.client.request("POST", `/matches/${id}/result`, body);
  }

  voidMatch(id: string, body: Record<string, unknown>): Promise<MatchRecord> {
    return this.client.request("POST", `/matches/${id}/void`, body);
  }
}
