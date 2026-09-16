/**
 * Cards, the points they carry, and the bans those points add up to.
 *
 * This is the one part of the league where what happens to a player depends on
 * everything that happened to them before. A booking on its own is worth a fine
 * and nothing else; the same booking as somebody's fifth of the season is worth
 * a one-match ban, and their tenth is worth two. Reading a single card tells you
 * almost nothing, which is the point.
 */

export const OFFENCES = [
  'dissent',
  'unsportingBehaviour',
  'persistentFouling',
  'seriousFoulPlay',
  'violentConduct',
  'denyingGoalscoringOpportunity',
] as const;
export type Offence = (typeof OFFENCES)[number];

export const CARD_COLOURS = ['yellow', 'red'] as const;
export type CardColour = (typeof CARD_COLOURS)[number];

/** What each offence is worth, and what colour the referee shows for it. */
export const OFFENCE_TARIFF: Record<
  Offence,
  { colour: CardColour; points: number; finePence: number }
> = {
  dissent: { colour: 'yellow', points: 1, finePence: 1000 },
  unsportingBehaviour: { colour: 'yellow', points: 1, finePence: 1000 },
  persistentFouling: { colour: 'yellow', points: 2, finePence: 1500 },
  denyingGoalscoringOpportunity: { colour: 'red', points: 3, finePence: 3500 },
  seriousFoulPlay: { colour: 'red', points: 4, finePence: 5000 },
  violentConduct: { colour: 'red', points: 6, finePence: 8000 },
};

/**
 * A red card bans a player for a set number of games on its own, before any
 * accumulation is considered. The two are served together, not added up.
 */
export const STRAIGHT_RED_BAN: Record<Offence, number> = {
  dissent: 0,
  unsportingBehaviour: 0,
  persistentFouling: 0,
  denyingGoalscoringOpportunity: 1,
  seriousFoulPlay: 2,
  violentConduct: 3,
};

/**
 * Every time a player's running total crosses one of these thresholds, they
 * pick up a ban of that length. Read worst-first so the heaviest threshold a
 * crossing satisfies is the one that counts.
 */
export const ACCUMULATION_THRESHOLDS: readonly { atPoints: number; matches: number }[] = [
  { atPoints: 20, matches: 4 },
  { atPoints: 15, matches: 3 },
  { atPoints: 10, matches: 2 },
  { atPoints: 5, matches: 1 },
];

export const DISCIPLINE_STATUSES = ['recorded', 'rescinded'] as const;
export type DisciplineStatus = (typeof DISCIPLINE_STATUSES)[number];

export interface CardRow {
  id: number;
  fixture_id: number;
  player_id: number;
  team_id: number;
  offence: string;
  colour: string;
  points: number;
  fine_pence: number;
  straight_ban: number;
  accumulation_ban: number;
  running_points: number;
  status: string;
  shown_on: string;
  rescinded_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: number;
  fixtureId: number;
  playerId: number;
  teamId: number;
  offence: Offence;
  colour: CardColour;
  points: number;
  finePence: number;
  straightBan: number;
  accumulationBan: number;
  runningPoints: number;
  status: DisciplineStatus;
  shownOn: string;
  rescindedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isOffence(value: string): value is Offence {
  return (OFFENCES as readonly string[]).includes(value);
}

export function toCard(row: CardRow): Card {
  const offence = isOffence(row.offence) ? row.offence : 'dissent';
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    playerId: row.player_id,
    teamId: row.team_id,
    offence,
    colour: row.colour === 'red' ? 'red' : 'yellow',
    points: row.points,
    finePence: row.fine_pence,
    straightBan: row.straight_ban,
    accumulationBan: row.accumulation_ban,
    runningPoints: row.running_points,
    status: row.status === 'rescinded' ? 'rescinded' : 'recorded',
    shownOn: row.shown_on,
    rescindedOn: row.rescinded_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The ban a card picks up for taking a player's running total past a threshold.
 *
 * Both totals are needed, not just the new one: a card is only worth a ban if
 * the threshold sits strictly between where the player was and where they now
 * are. Sitting on 5 already and going to 6 crosses nothing.
 */
export function accumulationBanFor(pointsBefore: number, pointsAfter: number): number {
  for (const threshold of ACCUMULATION_THRESHOLDS) {
    if (pointsBefore < threshold.atPoints && pointsAfter >= threshold.atPoints) {
      return threshold.matches;
    }
  }
  return 0;
}

/** The whole ban a card carries: the straight one and the accumulated one served together. */
export function banFor(offence: Offence, pointsBefore: number, pointsAfter: number): number {
  return Math.max(STRAIGHT_RED_BAN[offence], accumulationBanFor(pointsBefore, pointsAfter));
}

/** True when a card still counts towards a player's record. */
export function stands(card: Card): boolean {
  return card.status === 'recorded';
}
