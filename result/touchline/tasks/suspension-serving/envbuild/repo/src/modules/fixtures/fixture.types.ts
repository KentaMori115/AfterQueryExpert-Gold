/**
 * A fixture is one game between two sides in a division.
 *
 * Scheduling is kept apart from what happened: this module decides when and
 * where a game is played and whether it was called off, and the results module
 * decides what the score was. A fixture reaches `played` only by having a
 * result reported against it.
 */

export const FIXTURE_STATUSES = [
  'scheduled',
  'postponed',
  'played',
  'awarded',
  'abandoned',
] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

/** Which status a fixture may move to, and from where. */
export const FIXTURE_TRANSITIONS: Record<FixtureStatus, readonly FixtureStatus[]> = {
  scheduled: ['postponed', 'played', 'awarded', 'abandoned'],
  postponed: ['scheduled', 'awarded'],
  abandoned: ['scheduled', 'awarded'],
  played: [],
  awarded: [],
};

/**
 * A kick-off at or after this time needs a ground that can be lit.
 * Grassroots games are called off rather than finished in the dark.
 */
export const LATE_KICK_OFF = '15:00';

/** Why a fixture was awarded rather than played. */
export const AWARD_REASONS = ['noShow', 'ineligiblePlayer', 'withdrawal', 'groundUnfit'] as const;
export type AwardReason = (typeof AWARD_REASONS)[number];

/**
 * The score a walkover is recorded as, by reason. A club that fields somebody
 * it should not have loses by more than one that simply failed to turn up.
 */
export const AWARD_SCORELINE: Record<AwardReason, { winner: number; loser: number }> = {
  noShow: { winner: 3, loser: 0 },
  ineligiblePlayer: { winner: 3, loser: 0 },
  withdrawal: { winner: 3, loser: 0 },
  groundUnfit: { winner: 1, loser: 0 },
};

export interface FixtureRow {
  id: number;
  division_id: number;
  home_team_id: number;
  away_team_id: number;
  venue_id: number;
  played_on: string;
  kick_off: string;
  status: string;
  postponed_on: string | null;
  awarded_to_team_id: number | null;
  award_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fixture {
  id: number;
  divisionId: number;
  homeTeamId: number;
  awayTeamId: number;
  venueId: number;
  playedOn: string;
  kickOff: string;
  status: FixtureStatus;
  postponedOn: string | null;
  awardedToTeamId: number | null;
  awardReason: AwardReason | null;
  createdAt: string;
  updatedAt: string;
}

export function isAwardReason(value: string): value is AwardReason {
  return (AWARD_REASONS as readonly string[]).includes(value);
}

export function isFixtureStatus(value: string): value is FixtureStatus {
  return (FIXTURE_STATUSES as readonly string[]).includes(value);
}

export function toFixture(row: FixtureRow): Fixture {
  return {
    id: row.id,
    divisionId: row.division_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    venueId: row.venue_id,
    playedOn: row.played_on,
    kickOff: row.kick_off,
    status: isFixtureStatus(row.status) ? row.status : 'scheduled',
    postponedOn: row.postponed_on,
    awardedToTeamId: row.awarded_to_team_id,
    awardReason:
      row.award_reason !== null && isAwardReason(row.award_reason) ? row.award_reason : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** True when a kick-off is late enough to need floodlights. */
export function needsFloodlights(kickOff: string): boolean {
  return kickOff >= LATE_KICK_OFF;
}

/**
 * The scoreline an awarded game is recorded as, from the side it went to and why.
 * Returns null when the game was not awarded, so the table can tell the two apart.
 */
export function awardedScoreline(
  fixture: Fixture,
): { homeGoals: number; awayGoals: number } | null {
  if (fixture.status !== 'awarded') return null;
  if (fixture.awardedToTeamId === null || fixture.awardReason === null) return null;
  const line = AWARD_SCORELINE[fixture.awardReason];
  const homeWon = fixture.awardedToTeamId === fixture.homeTeamId;
  return homeWon
    ? { homeGoals: line.winner, awayGoals: line.loser }
    : { homeGoals: line.loser, awayGoals: line.winner };
}

/** True when the fixture is still waiting to be played. */
export function isOutstanding(fixture: Fixture): boolean {
  return fixture.status === 'scheduled' || fixture.status === 'postponed';
}

/** True when the fixture has an outcome the table should count. */
export function counts(fixture: Fixture): boolean {
  return fixture.status === 'played' || fixture.status === 'awarded';
}
