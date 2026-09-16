import type { TournamentService } from "../../engine/tournament/index.js";
import { json } from "../http.js";
import type { Router } from "../router.js";

export function registerPlayerRoutes(router: Router, service: TournamentService): void {
  router.add("POST", "/players", (request) => {
    const body = asRecord(request.body);
    const player = service.createPlayer({
      id: String(body.id),
      displayName: String(body.displayName),
      createdAt: Number(body.createdAt),
      ...(body.skillRating !== undefined ? { skillRating: Number(body.skillRating) } : {}),
      ...(body.level !== undefined ? { level: Number(body.level) } : {}),
      ...(body.vip !== undefined ? { vip: Boolean(body.vip) } : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags.map(String) } : {}),
    });
    return json(201, player);
  });

  router.add("GET", "/players/:id/profile", (request) => json(200, service.profile(request.params.id!)));

  router.add("GET", "/players/:id/history", (request) =>
    json(200, { playerId: request.params.id, history: service.profile(request.params.id!).profile.history }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
