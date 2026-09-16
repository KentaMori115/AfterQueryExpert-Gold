import type { PlayerRecord } from "../../types.js";
import { comparePlayersBySkill } from "../../domain/players/player.js";

export interface TeamAssignment {
  readonly name: string;
  readonly players: readonly PlayerRecord[];
  readonly totalSkill: number;
  readonly averageSkill: number;
}

export function snakeDraft(players: readonly PlayerRecord[], teamCount: number): TeamAssignment[] {
  const ordered = [...players].sort(comparePlayersBySkill);
  const teams: PlayerRecord[][] = Array.from({ length: teamCount }, () => []);
  let direction = 1;
  let index = 0;
  for (const player of ordered) {
    teams[index]!.push(player);
    index += direction;
    if (index === teamCount || index < 0) {
      direction *= -1;
      index += direction;
    }
  }
  return teams.map((members, teamIndex) => {
    const totalSkill = members.reduce((sum, member) => sum + member.skillRating, 0);
    return {
      name: `team_${teamIndex + 1}`,
      players: Object.freeze(members),
      totalSkill,
      averageSkill: members.length === 0 ? 0 : totalSkill / members.length,
    };
  });
}

export function skillSpread(teams: readonly TeamAssignment[]): number {
  if (teams.length === 0) {
    return 0;
  }
  const averages = teams.map((team) => team.averageSkill);
  return Math.max(...averages) - Math.min(...averages);
}

export function pairClosest(players: readonly PlayerRecord[]): Array<readonly [PlayerRecord, PlayerRecord]> {
  const remaining = [...players].sort(comparePlayersBySkill);
  const pairs: Array<readonly [PlayerRecord, PlayerRecord]> = [];
  while (remaining.length >= 2) {
    const first = remaining.shift()!;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const distance = Math.abs(first.skillRating - remaining[i]!.skillRating);
      if (distance < bestDistance || (distance === bestDistance && remaining[i]!.id < remaining[bestIndex]!.id)) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const partner = remaining.splice(bestIndex, 1)[0]!;
    pairs.push([first, partner]);
  }
  return pairs;
}
