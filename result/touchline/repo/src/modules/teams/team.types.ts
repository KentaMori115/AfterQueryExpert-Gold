/**
 * A team is the eleven a club enters into one division for one season.
 *
 * A club with a first team and a reserve side has two teams, and the rank is
 * what keeps them apart. The rank is not decoration: a club may not put two of
 * its teams in the same division, and a reserve side may never sit above the
 * first team, which is the rule that stops a club fielding its best players
 * lower down.
 */

export const TEAM_RANKS = ['first', 'reserves', 'third', 'fourth'] as const;
export type TeamRank = (typeof TEAM_RANKS)[number];

/** How the ranks order against each other. Lower is more senior. */
export const RANK_SENIORITY: Record<TeamRank, number> = {
  first: 1,
  reserves: 2,
  third: 3,
  fourth: 4,
};

/** The suffix printed after the club name for each rank. */
export const RANK_SUFFIX: Record<TeamRank, string> = {
  first: '',
  reserves: 'Reserves',
  third: 'Thirds',
  fourth: 'Fourths',
};

export const TEAM_STATUSES = ['entered', 'withdrawn'] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export interface TeamRow {
  id: number;
  club_id: number;
  division_id: number;
  rank: string;
  status: string;
  entered_on: string;
  withdrawn_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: number;
  clubId: number;
  divisionId: number;
  rank: TeamRank;
  status: TeamStatus;
  enteredOn: string;
  withdrawnOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isTeamRank(value: string): value is TeamRank {
  return (TEAM_RANKS as readonly string[]).includes(value);
}

export function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    clubId: row.club_id,
    divisionId: row.division_id,
    rank: isTeamRank(row.rank) ? row.rank : 'first',
    status: row.status === 'withdrawn' ? 'withdrawn' : 'entered',
    enteredOn: row.entered_on,
    withdrawnOn: row.withdrawn_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The name a team appears under on a fixture list. */
export function displayName(clubName: string, rank: TeamRank): string {
  const suffix = RANK_SUFFIX[rank];
  return suffix === '' ? clubName : `${clubName} ${suffix}`;
}

/** True when a team still counts towards a division and its table. */
export function isStanding(team: Team): boolean {
  return team.status === 'entered';
}
