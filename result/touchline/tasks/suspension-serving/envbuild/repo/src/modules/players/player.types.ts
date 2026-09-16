/**
 * The players clubs register.
 *
 * A player belongs to one club at a time. Moving to another club is a transfer
 * rather than a new registration, so the league keeps one record per person and
 * can still answer who they were registered to on any given day.
 *
 * Age is settled against the day of registration, never against the clock, so a
 * registration that was legal when it happened stays legal afterwards.
 */

export const PLAYER_STATUSES = ['registered', 'released'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** The youngest a player may be, in whole years, on the day they register. */
export const MIN_AGE_YEARS = 16;
export const MAX_AGE_YEARS = 70;

export const MIN_SQUAD_NUMBER = 1;
export const MAX_SQUAD_NUMBER = 99;

/**
 * What each position is worth when a club counts whether it has a whole team.
 * A side needs a keeper and at least seven outfield players to fulfil a fixture.
 */
export const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const;
export type Position = (typeof POSITIONS)[number];

export const MIN_KEEPERS_TO_PLAY = 1;
export const MIN_OUTFIELD_TO_PLAY = 7;

export interface PlayerRow {
  id: number;
  club_id: number;
  first_name: string;
  last_name: string;
  born_on: string;
  position: string;
  squad_number: number;
  status: string;
  registered_on: string;
  released_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: number;
  clubId: number;
  firstName: string;
  lastName: string;
  bornOn: string;
  position: Position;
  squadNumber: number;
  status: PlayerStatus;
  registeredOn: string;
  releasedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isPosition(value: string): value is Position {
  return (POSITIONS as readonly string[]).includes(value);
}

export function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    clubId: row.club_id,
    firstName: row.first_name,
    lastName: row.last_name,
    bornOn: row.born_on,
    position: isPosition(row.position) ? row.position : 'midfielder',
    squadNumber: row.squad_number,
    status: row.status === 'released' ? 'released' : 'registered',
    registeredOn: row.registered_on,
    releasedOn: row.released_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Whole years between two days, counting a birthday that has not come round yet as not reached. */
export function yearsBetween(bornOn: string, asOf: string): number {
  const [by, bm, bd] = bornOn.split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = asOf.split('-').map(Number) as [number, number, number];
  let years = ay - by;
  if (am < bm || (am === bm && ad < bd)) years -= 1;
  return years;
}

/** The name a team sheet prints. */
export function fullName(player: Player): string {
  return `${player.firstName} ${player.lastName}`;
}
