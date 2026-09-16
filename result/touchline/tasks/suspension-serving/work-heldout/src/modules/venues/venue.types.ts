/**
 * The grounds the league plays on.
 *
 * A venue carries the two things that decide whether a fixture can go ahead
 * there: what it is made of, and whether it can be lit. The surface is a lookup
 * rather than a free field, because how many games a pitch takes in a day
 * depends on it, and a grass pitch in February is not a 3G pitch.
 */

export const SURFACES = ['grass', 'threeG', 'astro'] as const;
export type Surface = (typeof SURFACES)[number];

/** How many games one pitch of each surface will take in a single day. */
export const GAMES_PER_PITCH_PER_DAY: Record<Surface, number> = {
  grass: 2,
  threeG: 5,
  astro: 4,
};

/** How many days notice a surface needs before it can host, once booked off. */
export const REST_DAYS_AFTER_HOSTING: Record<Surface, number> = {
  grass: 2,
  threeG: 0,
  astro: 1,
};

export const VENUE_STATUSES = ['open', 'closed'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

export const MIN_PITCHES = 1;
export const MAX_PITCHES = 12;

export interface VenueRow {
  id: number;
  name: string;
  address_line: string;
  postcode: string;
  surface: string;
  pitch_count: number;
  floodlit: number;
  status: string;
  closed_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Venue {
  id: number;
  name: string;
  addressLine: string;
  postcode: string;
  surface: Surface;
  pitchCount: number;
  floodlit: boolean;
  status: VenueStatus;
  closedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

export function toVenue(row: VenueRow): Venue {
  return {
    id: row.id,
    name: row.name,
    addressLine: row.address_line,
    postcode: row.postcode,
    surface: isSurface(row.surface) ? row.surface : 'grass',
    pitchCount: row.pitch_count,
    floodlit: row.floodlit === 1,
    status: row.status === 'closed' ? 'closed' : 'open',
    closedOn: row.closed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The most games a whole venue will take on one day, across all its pitches. */
export function dailyCapacity(venue: Venue): number {
  return venue.pitchCount * GAMES_PER_PITCH_PER_DAY[venue.surface];
}
