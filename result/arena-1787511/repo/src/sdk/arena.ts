import { createArena } from "../api/server.js";
import { ArenaFlowClient } from "./client.js";
import { MatchApi } from "./matches.js";
import { PlayerApi } from "./players.js";
import { RankingApi } from "./rankings.js";
import { RewardApi } from "./rewards.js";
import { TournamentApi } from "./tournaments.js";

export class ArenaFlowSdk {
  readonly tournaments: TournamentApi;
  readonly players: PlayerApi;
  readonly matches: MatchApi;
  readonly rankings: RankingApi;
  readonly rewards: RewardApi;

  constructor(client: ArenaFlowClient) {
    this.tournaments = new TournamentApi(client);
    this.players = new PlayerApi(client);
    this.matches = new MatchApi(client);
    this.rankings = new RankingApi(client);
    this.rewards = new RewardApi(client);
  }

  static inMemory(): ArenaFlowSdk {
    const { router } = createArena();
    return new ArenaFlowSdk(new ArenaFlowClient({ router }));
  }
}
