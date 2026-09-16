/**
 * A season is the window everything else in the league belongs to.
 *
 * It carries its own scoring, because leagues do change what a win is worth,
 * and a table computed for last season has to keep using last season's rules
 * rather than whatever the league settled on afterwards.
 */

export const SEASON_STATUSES = ['planning', 'running', 'closed'] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

/** Which status a season may move to, and from where. */
export const SEASON_TRANSITIONS: Record<SeasonStatus, readonly SeasonStatus[]> = {
  planning: ['running'],
  running: ['closed'],
  closed: [],
};

/** What a result is worth, unless a season says otherwise. */
export const DEFAULT_POINTS_WIN = 3;
export const DEFAULT_POINTS_DRAW = 1;
export const DEFAULT_POINTS_LOSS = 0;

export interface SeasonRow {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string;
  registration_closes_on: string;
  status: string;
  points_win: number;
  points_draw: number;
  points_loss: number;
  opened_on: string | null;
  closed_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Season {
  id: number;
  name: string;
  startsOn: string;
  endsOn: string;
  registrationClosesOn: string;
  status: SeasonStatus;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  openedOn: string | null;
  closedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isSeasonStatus(value: string): value is SeasonStatus {
  return (SEASON_STATUSES as readonly string[]).includes(value);
}

export function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    registrationClosesOn: row.registration_closes_on,
    status: isSeasonStatus(row.status) ? row.status : 'planning',
    pointsWin: row.points_win,
    pointsDraw: row.points_draw,
    pointsLoss: row.points_loss,
    openedOn: row.opened_on,
    closedOn: row.closed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** True when a season is far enough along that fixtures may be played in it. */
export function isUnderway(season: Season): boolean {
  return season.status === 'running';
}

/** True when nothing about the season may change any more. */
export function isSettled(season: Season): boolean {
  return season.status === 'closed';
}
