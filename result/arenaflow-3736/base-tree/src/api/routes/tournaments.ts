import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerTournamentRoutes(router: Router, service: TournamentService): void {
  router.add("POST", "/tournaments", (request) => {
    const body = asRecord(request.body);
    const tournament = service.createTournament({
      id: String(body.id),
      name: String(body.name),
      format: body.format as never,
      createdAt: Number(body.createdAt),
      ...(body.seasonId ? { seasonId: String(body.seasonId) } : {}),
      ...(body.capacity !== undefined ? { capacity: Number(body.capacity) } : {}),
      ...(body.scoring ? { scoring: body.scoring as never } : {}),
      ...(body.rules ? { rules: body.rules as never } : {}),
      ...(body.rewards ? { rewards: body.rewards as never } : {}),
    });
    return json(201, tournament);
  });

  router.add("GET", "/tournaments/:id", (request) => json(200, service.getTournament(request.params.id!)));

  router.add("POST", "/tournaments/:id/register", (request) => {
    const body = asRecord(request.body);
    return json(200, service.register(request.params.id!, String(body.playerId), Number(body.at)));
  });

  router.add("POST", "/tournaments/:id/open", (request) => {
    const body = asRecord(request.body);
    return json(200, service.openRegistration(request.params.id!, Number(body.at)));
  });

  router.add("POST", "/tournaments/:id/start", (request) => {
    const body = asRecord(request.body);
    return json(200, service.start(request.params.id!, Number(body.at)));
  });

  router.add("POST", "/tournaments/:id/end", (request) => {
    const body = asRecord(request.body);
    return json(200, service.end(request.params.id!, Number(body.at)));
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
