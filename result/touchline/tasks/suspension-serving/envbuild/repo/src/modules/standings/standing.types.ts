/**
 * The league table.
 *
 * This is a reading, not a stored thing: it is assembled from the confirmed
 * results of a division every time it is asked for, and it takes an `asOf` day
 * so last week's table can still be produced exactly as it stood last week.
 *
 * The ordering is where every league argues. Points decide it, then goal
 * difference, then goals scored, and only then the games between the two sides
 * involved. Sorting by points alone, or falling back to insertion order, gets a
 * different table from the same results.
 */

/** How a side's last few games went, newest first. */
export const FORM_LENGTH = 6;

export type FormLetter = 'W' | 'D' | 'L';

/** What each outcome is worth in the form guide, used to order equal sides last of all. */
export const FORM_WEIGHT: Record<FormLetter, number> = {
  W: 3,
  D: 1,
  L: 0,
};

/**
 * Where a side sits at the end of a season, from its position and the places
 * the division gives out. `safe` is everybody the season does not move.
 */
export const PLACINGS = ['promoted', 'safe', 'relegated'] as const;
export type Placing = (typeof PLACINGS)[number];

export interface StandingLine {
  position: number;
  teamId: number;
  clubId: number;
  clubName: string;
  shortName: string;
  rank: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string;
  placing: Placing;
}

export interface Table {
  divisionId: number;
  seasonId: number;
  divisionName: string;
  tier: number;
  asOf: string;
  played: number;
  outstanding: number;
  goalsScored: number;
  complete: boolean;
  lines: StandingLine[];
}

/** A running tally for one side while the table is being assembled. */
export interface Tally {
  teamId: number;
  clubId: number;
  clubName: string;
  shortName: string;
  rank: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: FormLetter[];
  /** Goals for and against each other side, kept so ties can be broken between them. */
  against: Map<number, { for: number; against: number; points: number }>;
}

export function emptyTally(
  teamId: number,
  clubId: number,
  clubName: string,
  shortName: string,
  rank: string,
): Tally {
  return {
    teamId,
    clubId,
    clubName,
    shortName,
    rank,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    form: [],
    against: new Map(),
  };
}

export function goalDifference(tally: Tally): number {
  return tally.goalsFor - tally.goalsAgainst;
}

/** The form guide as the letters a programme would print, newest first. */
export function formOf(tally: Tally): string {
  return tally.form.slice(0, FORM_LENGTH).join('');
}

/**
 * How the two sides did against each other, for breaking a tie between exactly
 * those two. Returns null when they have not met, which is why the sort falls
 * through to the club name rather than treating "not met" as level.
 */
export function headToHead(
  left: Tally,
  right: Tally,
): { points: number; goalDifference: number } | null {
  const seen = left.against.get(right.teamId);
  if (seen === undefined) return null;
  return { points: seen.points, goalDifference: seen.for - seen.against };
}

/**
 * The order a table reads in.
 *
 * Worst-first is never what a league wants, so every comparison here is
 * best-first: more points above fewer, better difference above worse. The last
 * step is the club name, which is arbitrary but stable, so two sides that are
 * genuinely level always come out in the same order however the rows arrived.
 */
export function compareLines(left: Tally, right: Tally): number {
  if (left.points !== right.points) return right.points - left.points;

  const leftDifference = goalDifference(left);
  const rightDifference = goalDifference(right);
  if (leftDifference !== rightDifference) return rightDifference - leftDifference;

  if (left.goalsFor !== right.goalsFor) return right.goalsFor - left.goalsFor;

  const between = headToHead(left, right);
  if (between !== null) {
    const other = headToHead(right, left);
    const otherPoints = other === null ? 0 : other.points;
    if (between.points !== otherPoints) return otherPoints - between.points;
    if (between.goalDifference !== 0) return -between.goalDifference;
  }

  return left.clubName.localeCompare(right.clubName);
}

/** Where a side ends up, from where it finished and what the division gives out. */
export function placingFor(
  position: number,
  lineCount: number,
  promotionPlaces: number,
  relegationPlaces: number,
): Placing {
  if (position <= promotionPlaces) return 'promoted';
  if (position > lineCount - relegationPlaces) return 'relegated';
  return 'safe';
}
