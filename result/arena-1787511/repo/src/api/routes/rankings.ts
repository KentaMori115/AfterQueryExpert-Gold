import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerRankingRoutes(router: Router, service: TournamentService): void {
  router.add("GET", "/leaderboards/:id", (request) => json(200, service.leaderboard(request.params.id!)));
  router.add("GET", "/rankings/:playerId", (request) => json(200, service.rankingsFor(request.params.playerId!)));
}
