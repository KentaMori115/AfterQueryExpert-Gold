import { ConflictError, NotFoundError } from "../../errors.js";
import type { PlayerId, PlayerRecord } from "../../types.js";
import { comparePlayersBySkill } from "./player.js";

export class PlayerRegistry {
  private readonly players = new Map<PlayerId, PlayerRecord>();

  register(player: PlayerRecord): PlayerRecord {
    if (this.players.has(player.id)) {
      throw new ConflictError(`player already registered: ${player.id}`, { id: player.id });
    }
    this.players.set(player.id, player);
    return player;
  }

  upsert(player: PlayerRecord): PlayerRecord {
    this.players.set(player.id, player);
    return player;
  }

  get(id: PlayerId): PlayerRecord {
    const player = this.players.get(id);
    if (!player) {
      throw new NotFoundError("player", id);
    }
    return player;
  }

  tryGet(id: PlayerId): PlayerRecord | undefined {
    return this.players.get(id);
  }

  has(id: PlayerId): boolean {
    return this.players.has(id);
  }

  list(): PlayerRecord[] {
    return [...this.players.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  listBySkill(): PlayerRecord[] {
    return this.list().sort(comparePlayersBySkill);
  }

  count(): number {
    return this.players.size;
  }

  snapshot(): ReadonlyMap<PlayerId, PlayerRecord> {
    return new Map(this.players);
  }

  restore(records: readonly PlayerRecord[]): void {
    this.players.clear();
    for (const record of records) {
      this.players.set(record.id, record);
    }
  }
}
