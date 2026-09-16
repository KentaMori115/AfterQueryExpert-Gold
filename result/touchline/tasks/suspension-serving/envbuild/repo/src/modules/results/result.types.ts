/**
 * What happened in a game, kept apart from when it was played.
 *
 * A result is reported by one of the two sides and has to be answered by the
 * other. That is what makes it trustworthy without anybody watching: the side
 * that did not report it either confirms the score or disputes it, and only a
 * confirmed result moves the fixture to played and reaches the table.
 */

export const RESULT_STATUSES = ['reported', 'confirmed', 'disputed'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Which status a result may move to, and from where. */
export const RESULT_TRANSITIONS: Record<ResultStatus, readonly ResultStatus[]> = {
  reported: ['confirmed', 'disputed'],
  disputed: ['confirmed'],
  confirmed: [],
};

export const MIN_GOALS = 0;
export const MAX_GOALS = 99;

/** What one side took from a game, before a season's own scoring is applied. */
export const OUTCOMES = ['win', 'draw', 'loss'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface ResultRow {
  id: number;
  fixture_id: number;
  home_goals: number;
  away_goals: number;
  reported_by_team_id: number;
  reported_on: string;
  status: string;
  answered_by_team_id: number | null;
  answered_on: string | null;
  settled_on: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Result {
  id: number;
  fixtureId: number;
  homeGoals: number;
  awayGoals: number;
  reportedByTeamId: number;
  reportedOn: string;
  status: ResultStatus;
  answeredByTeamId: number | null;
  answeredOn: string | null;
  settledOn: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isResultStatus(value: string): value is ResultStatus {
  return (RESULT_STATUSES as readonly string[]).includes(value);
}

export function toResult(row: ResultRow): Result {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    reportedByTeamId: row.reported_by_team_id,
    reportedOn: row.reported_on,
    status: isResultStatus(row.status) ? row.status : 'reported',
    answeredByTeamId: row.answered_by_team_id,
    answeredOn: row.answered_on,
    settledOn: row.settled_on,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** What the home side took from a scoreline. */
export function outcomeForHome(homeGoals: number, awayGoals: number): Outcome {
  if (homeGoals > awayGoals) return 'win';
  if (homeGoals < awayGoals) return 'loss';
  return 'draw';
}

/** The same scoreline from the away side. */
export function flip(outcome: Outcome): Outcome {
  if (outcome === 'win') return 'loss';
  if (outcome === 'loss') return 'win';
  return 'draw';
}

/** True when the score is settled enough for the table to count it. */
export function isFinal(result: Result): boolean {
  return result.status === 'confirmed';
}
