import type { TournamentService } from "../../engine/tournament/index.js";
import { Router } from "../router.js";
import { registerMatchRoutes } from "./matches.js";
import { registerPlayerRoutes } from "./players.js";
import { registerRankingRoutes } from "./rankings.js";
import { registerRewardRoutes } from "./rewards.js";
import { registerTournamentRoutes } from "./tournaments.js";

export function createApiRouter(service: TournamentService): Router {
  const router = new Router();
  router.add("GET", "/health", () => ({
    status: 200,
    body: { ok: true, name: "arenaflow" },
  }));
  registerTournamentRoutes(router, service);
  registerPlayerRoutes(router, service);
  registerMatchRoutes(router, service);
  registerRankingRoutes(router, service);
  registerRewardRoutes(router, service);
  return router;
}

export * from "./tournaments.js";
export * from "./players.js";
export * from "./matches.js";
export * from "./rankings.js";
export * from "./rewards.js";
