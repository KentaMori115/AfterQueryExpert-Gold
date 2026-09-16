/**
 * The clubs that make up the league.
 *
 * A club is not a team. A club is the body that applies, pays, gets suspended
 * and resigns; a team is the eleven it enters into a division. Keeping them
 * apart matters because a club with three teams is suspended as one thing.
 */

export const CLUB_STATUSES = ['applied', 'member', 'suspended', 'resigned'] as const;
export type ClubStatus = (typeof CLUB_STATUSES)[number];

/** Which status a club may move to, and from where. */
export const CLUB_TRANSITIONS: Record<ClubStatus, readonly ClubStatus[]> = {
  applied: ['member', 'resigned'],
  member: ['suspended', 'resigned'],
  suspended: ['member', 'resigned'],
  resigned: [],
};

/** The earliest founding year the league will believe. */
export const EARLIEST_FOUNDED_YEAR = 1850;
export const LATEST_FOUNDED_YEAR = 2100;

export interface ClubRow {
  id: number;
  name: string;
  short_name: string;
  founded_year: number;
  contact_email: string;
  home_venue_id: number | null;
  status: string;
  applied_on: string;
  admitted_on: string | null;
  left_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Club {
  id: number;
  name: string;
  shortName: string;
  foundedYear: number;
  contactEmail: string;
  homeVenueId: number | null;
  status: ClubStatus;
  appliedOn: string;
  admittedOn: string | null;
  leftOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isClubStatus(value: string): value is ClubStatus {
  return (CLUB_STATUSES as readonly string[]).includes(value);
}

export function toClub(row: ClubRow): Club {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    foundedYear: row.founded_year,
    contactEmail: row.contact_email,
    homeVenueId: row.home_venue_id,
    status: isClubStatus(row.status) ? row.status : 'applied',
    appliedOn: row.applied_on,
    admittedOn: row.admitted_on,
    leftOn: row.left_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** True when a club is in good enough standing to enter a team. */
export function mayEnterTeams(club: Club): boolean {
  return club.status === 'member';
}
