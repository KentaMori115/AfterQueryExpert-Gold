import { MemoryPersistence } from "../persistence/index.js";
import { TournamentService } from "../engine/tournament/index.js";
import { seasonManager } from "../engine/seasons/index.js";
import { buildTournamentReport, renderReport } from "../engine/reporting/index.js";
import { RECIPE_WEEKEND_CUP } from "./recipes.js";

const T0 = 1_720_000_000_000;

export function runWeekendCupWalkthrough(): string {
  const store = new MemoryPersistence();
  const service = new TournamentService(store);
  const season = seasonManager.open(
    { id: "ssn_demo", name: "Demo Season", createdAt: T0, startsAt: T0, endsAt: T0 + 86_400_000 },
    T0,
  );
  service.createPlayer({ id: "plr_ann", displayName: "Ann", createdAt: T0, skillRating: 1200 });
  service.createPlayer({ id: "plr_ben", displayName: "Ben", createdAt: T0, skillRating: 1180, vip: true });
  service.createPlayer({ id: "plr_cam", displayName: "Cam", createdAt: T0, skillRating: 1010 });
  service.createPlayer({ id: "plr_deb", displayName: "Deb", createdAt: T0, skillRating: 990 });
  const tournament = service.createTournament({
    id: "tnm_weekend",
    name: RECIPE_WEEKEND_CUP.name,
    format: RECIPE_WEEKEND_CUP.format,
    createdAt: T0,
    seasonId: season.id,
    capacity: 8,
    scoring: RECIPE_WEEKEND_CUP.scoring,
    rewards: RECIPE_WEEKEND_CUP.rewards,
  });
  service.openRegistration(tournament.id, T0 + 1);
  for (const playerId of ["plr_ann", "plr_ben", "plr_cam", "plr_deb"]) {
    service.register(tournament.id, playerId, T0 + 2);
  }
  service.start(tournament.id, T0 + 3);
  const pairs: Array<[string, string, string]> = [
    ["mch_1", "plr_ann", "plr_cam"],
    ["mch_2", "plr_ben", "plr_deb"],
    ["mch_3", "plr_ann", "plr_ben"],
  ];
  let cursor = T0 + 10;
  for (const [matchId, winner, loser] of pairs) {
    service.createMatch({ id: matchId, tournamentId: tournament.id, playerIds: [winner, loser], createdAt: cursor });
    service.startMatch(matchId, cursor + 1);
    service.submitPairResult({ matchId, winnerId: winner, loserId: loser, at: cursor + 2 });
    cursor += 10;
  }
  service.end(tournament.id, cursor);
  const rewards = service.distributeRewards(tournament.id, cursor + 1);
  const report = buildTournamentReport(
    service.getTournament(tournament.id),
    service.leaderboard(tournament.id).entries,
    rewards,
    store.listScores(tournament.id),
  );
  return [renderReport(report), `events=${store.journal.count()}`, `season=${season.id}`].join("\n");
}
