import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerMatchRoutes(router: Router, service: TournamentService): void {
  router.add("POST", "/matches", (request) => {
    const body = asRecord(request.body);
    const match = service.createMatch({
      id: String(body.id),
      tournamentId: String(body.tournamentId),
      playerIds: Array.isArray(body.playerIds) ? body.playerIds.map(String) : [],
      createdAt: Number(body.createdAt),
    });
    return json(201, match);
  });

  router.add("POST", "/matches/:id/start", (request) => {
    const body = asRecord(request.body);
    return json(200, service.startMatch(request.params.id!, Number(body.at)));
  });

  router.add("POST", "/matches/:id/void", (request) => {
    const body = asRecord(request.body);
    return json(
      200,
      service.voidMatch({
        matchId: request.params.id!,
        reason: String(body.reason ?? ""),
        at: Number(body.at),
      }),
    );
  });

  router.add("POST", "/matches/:id/result", (request) => {
    const body = asRecord(request.body);
    return json(
      200,
      service.submitPairResult({
        matchId: request.params.id!,
        winnerId: String(body.winnerId),
        loserId: String(body.loserId),
        at: Number(body.at),
        ...(body.winnerScore !== undefined ? { winnerScore: Number(body.winnerScore) } : {}),
        ...(body.loserScore !== undefined ? { loserScore: Number(body.loserScore) } : {}),
      }),
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
