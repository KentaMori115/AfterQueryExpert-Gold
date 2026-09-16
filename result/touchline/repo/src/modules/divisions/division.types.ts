/**
 * A division is one table inside a season.
 *
 * Tier 1 is the top division and the numbers grow downwards, which is the way
 * every league writes it and the way promotion has to read: a team promoted
 * from tier 3 arrives in tier 2.
 */

export const DIVISION_STATUSES = ['forming', 'fixed', 'completed'] as const;
export type DivisionStatus = (typeof DIVISION_STATUSES)[number];

/** Which status a division may move to, and from where. */
export const DIVISION_TRANSITIONS: Record<DivisionStatus, readonly DivisionStatus[]> = {
  forming: ['fixed'],
  fixed: ['completed'],
  completed: [],
};

export const TOP_TIER = 1;
export const BOTTOM_TIER = 8;
export const MIN_TEAM_CAPACITY = 4;
export const MAX_TEAM_CAPACITY = 24;

/**
 * How many games each team plays the others in a division of a given size.
 * Small divisions play three times round so the season is long enough to matter.
 */
export const ROUNDS_BY_CAPACITY: readonly { upTo: number; rounds: number }[] = [
  { upTo: 6, rounds: 4 },
  { upTo: 9, rounds: 3 },
  { upTo: 24, rounds: 2 },
];

export function roundsFor(capacity: number): number {
  for (const band of ROUNDS_BY_CAPACITY) {
    if (capacity <= band.upTo) return band.rounds;
  }
  return 2;
}

export interface DivisionRow {
  id: number;
  season_id: number;
  name: string;
  tier: number;
  team_capacity: number;
  promotion_places: number;
  relegation_places: number;
  status: string;
  fixed_on: string | null;
  completed_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Division {
  id: number;
  seasonId: number;
  name: string;
  tier: number;
  teamCapacity: number;
  promotionPlaces: number;
  relegationPlaces: number;
  status: DivisionStatus;
  fixedOn: string | null;
  completedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isDivisionStatus(value: string): value is DivisionStatus {
  return (DIVISION_STATUSES as readonly string[]).includes(value);
}

export function toDivision(row: DivisionRow): Division {
  return {
    id: row.id,
    seasonId: row.season_id,
    name: row.name,
    tier: row.tier,
    teamCapacity: row.team_capacity,
    promotionPlaces: row.promotion_places,
    relegationPlaces: row.relegation_places,
    status: isDivisionStatus(row.status) ? row.status : 'forming',
    fixedOn: row.fixed_on,
    completedOn: row.completed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** True while teams may still be entered or withdrawn. */
export function isOpenForEntries(division: Division): boolean {
  return division.status === 'forming';
}

/** How many games a full division of this size plays in total. */
export function totalFixtures(division: Division): number {
  const teams = division.teamCapacity;
  return (teams * (teams - 1) * roundsFor(teams)) / 2;
}
