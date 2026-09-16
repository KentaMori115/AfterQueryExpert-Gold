import type { PlayerRecord } from "../../../types.js";
import { snakeDraft, type TeamAssignment } from "../../matchmaking/balancing.js";

export interface TeamStanding {
  readonly team: string;
  readonly score: number;
  readonly members: readonly string[];
}

export function assignTeams(players: readonly PlayerRecord[], teamCount = 2): TeamAssignment[] {
  return snakeDraft(players, teamCount);
}

export function teamScore(assignment: TeamAssignment, playerScores: ReadonlyMap<string, number>): number {
  return assignment.players.reduce((sum, player) => sum + (playerScores.get(player.id) ?? 0), 0);
}

export function teamStandings(
  teams: readonly TeamAssignment[],
  playerScores: ReadonlyMap<string, number>,
): TeamStanding[] {
  return teams
    .map((team) => ({
      team: team.name,
      score: teamScore(team, playerScores),
      members: team.players.map((player) => player.id),
    }))
    .sort((a, b) => b.score - a.score || a.team.localeCompare(b.team));
}
