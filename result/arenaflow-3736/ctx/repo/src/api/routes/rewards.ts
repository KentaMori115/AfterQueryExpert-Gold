import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerRewardRoutes(router: Router, service: TournamentService): void {
  router.add("POST", "/rewards/distribute", (request) => {
    const body = asRecord(request.body);
    return json(200, service.distributeRewards(String(body.tournamentId), Number(body.at)));
  });

  router.add("GET", "/rewards/:playerId", (request) =>
    json(200, { playerId: request.params.playerId, rewards: service.listRewards(request.params.playerId!) }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
