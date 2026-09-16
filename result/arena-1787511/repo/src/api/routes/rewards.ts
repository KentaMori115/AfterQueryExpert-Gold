import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerRewardRoutes(router: Router, service: TournamentService): void {
  router.add("POST", "/rewards/distribute", (request) => {
    const body = asRecord(request.body);
    return json(200, service.distributeRewards(String(body.tournamentId), Number(body.at)));
  });

  router.add("POST", "/rewards/recall", (request) => {
    const body = asRecord(request.body);
    return json(
      200,
      service.recallRewards(String(body.tournamentId), Number(body.at), String(body.reason ?? "")),
    );
  });

  router.add("POST", "/rewards/:id/revoke", (request) => {
    const body = asRecord(request.body);
    return json(
      200,
      service.revokeReward(request.params.id!, Number(body.at), String(body.reason ?? "")),
    );
  });

  router.add("POST", "/rewards/:id/claim", (request) => {
    const body = asRecord(request.body);
    return json(200, service.claimReward(request.params.id!, Number(body.at)));
  });

  router.add("POST", "/rewards/expire", (request) => {
    const body = asRecord(request.body);
    return json(200, service.expireClaims(String(body.tournamentId), Number(body.at)));
  });

  router.add("GET", "/rewards/statement/:tournamentId", (request) =>
    json(200, service.payoutStatement(request.params.tournamentId!)),
  );

  router.add("GET", "/rewards/:playerId/balance", (request) =>
    json(200, service.rewardBalance(request.params.playerId!)),
  );

  router.add("GET", "/rewards/:playerId", (request) =>
    json(200, { playerId: request.params.playerId, rewards: service.listRewards(request.params.playerId!) }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
