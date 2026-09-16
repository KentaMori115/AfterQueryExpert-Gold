import type { TournamentService } from "../../engine/tournament/index.js";
import { requiredFlag } from "../format.js";

export async function runCommand(
  command: string,
  flags: Record<string, string>,
  service: TournamentService,
): Promise<unknown> {
  switch (command) {
    case "version":
      return { name: "arenaflow", version: "1.0.0" };
    case "player:create":
      return service.createPlayer({
        id: requiredFlag(flags, "id"),
        displayName: requiredFlag(flags, "name"),
        createdAt: Number(requiredFlag(flags, "at")),
        vip: flags.vip === "true",
        ...(flags.level ? { level: Number(flags.level) } : {}),
        ...(flags.skill ? { skillRating: Number(flags.skill) } : {}),
      });
    case "tournament:create":
      return service.createTournament({
        id: requiredFlag(flags, "id"),
        name: requiredFlag(flags, "name"),
        format: (flags.format ?? "leaderboard") as never,
        createdAt: Number(requiredFlag(flags, "at")),
      });
    case "tournament:open":
      return service.openRegistration(requiredFlag(flags, "id"), Number(requiredFlag(flags, "at")));
    case "tournament:register":
      return service.register(
        requiredFlag(flags, "id"),
        requiredFlag(flags, "player"),
        Number(requiredFlag(flags, "at")),
      );
    case "tournament:start":
      return service.start(requiredFlag(flags, "id"), Number(requiredFlag(flags, "at")));
    case "tournament:end":
      return service.end(requiredFlag(flags, "id"), Number(requiredFlag(flags, "at")));
    case "match:create":
      return service.createMatch({
        id: requiredFlag(flags, "id"),
        tournamentId: requiredFlag(flags, "tournament"),
        playerIds: requiredFlag(flags, "players").split(","),
        createdAt: Number(requiredFlag(flags, "at")),
      });
    case "match:start":
      return service.startMatch(requiredFlag(flags, "id"), Number(requiredFlag(flags, "at")));
    case "match:result":
      return service.submitPairResult({
        matchId: requiredFlag(flags, "id"),
        winnerId: requiredFlag(flags, "winner"),
        loserId: requiredFlag(flags, "loser"),
        at: Number(requiredFlag(flags, "at")),
      });
    case "match:void":
      return service.voidMatch({
        matchId: requiredFlag(flags, "id"),
        reason: requiredFlag(flags, "reason"),
        at: Number(requiredFlag(flags, "at")),
      });
    case "leaderboard":
      return service.leaderboard(requiredFlag(flags, "id"));
    case "rewards:distribute":
      return service.distributeRewards(requiredFlag(flags, "id"), Number(requiredFlag(flags, "at")));
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

export function availableCommands(): string[] {
  return [
    "help",
    "version",
    "player:create",
    "tournament:create",
    "tournament:open",
    "tournament:register",
    "tournament:start",
    "tournament:end",
    "match:create",
    "match:start",
    "match:result",
    "match:void",
    "leaderboard",
    "rewards:distribute",
  ];
}
