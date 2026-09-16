/** SQL for fixtures, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import {
  toFixture,
  type AwardReason,
  type Fixture,
  type FixtureRow,
  type FixtureStatus,
} from './fixture.types';

export interface NewFixture {
  divisionId: number;
  homeTeamId: number;
  awayTeamId: number;
  venueId: number;
  playedOn: string;
  kickOff: string;
}

export interface FixtureChanges {
  venueId?: number;
  playedOn?: string;
  kickOff?: string;
  status?: FixtureStatus;
  postponedOn?: string | null;
  awardedToTeamId?: number | null;
  awardReason?: AwardReason | null;
}

export interface FixtureFilter {
  divisionId?: number;
  teamId?: number;
  venueId?: number;
  status?: FixtureStatus;
  playedOn?: string;
}

export class FixtureRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewFixture): Fixture {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO fixtures
           (division_id, home_team_id, away_team_id, venue_id, played_on, kick_off,
            status, postponed_on, awarded_to_team_id, award_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.divisionId,
        input.homeTeamId,
        input.awayTeamId,
        input.venueId,
        input.playedOn,
        input.kickOff,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Fixture;
  }

  byId(id: number): Fixture | undefined {
    const row = asRow<FixtureRow>(this.db.prepare(`SELECT * FROM fixtures WHERE id = ?`).get(id));
    return row ? toFixture(row) : undefined;
  }

  /** Every meeting of two sides in a division, whichever way round they were drawn. */
  meetingsBetween(divisionId: number, teamA: number, teamB: number): Fixture[] {
    const found = asRows<FixtureRow>(
      this.db
        .prepare(
          `SELECT * FROM fixtures
            WHERE division_id = ?
              AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))
            ORDER BY played_on ASC, id ASC`,
        )
        .all(divisionId, teamA, teamB, teamB, teamA),
    );
    return found.map(toFixture);
  }

  /** How many games a ground already holds on a day, ignoring one fixture when re-checking. */
  countAtVenueOn(venueId: number, playedOn: string, exceptId?: number): number {
    const row = asRow<{ n: number }>(
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM fixtures
            WHERE venue_id = ? AND played_on = ?
              AND status IN ('scheduled', 'played', 'awarded')
              AND (? IS NULL OR id != ?)`,
        )
        .get(venueId, playedOn, exceptId ?? null, exceptId ?? 0),
    );
    return row?.n ?? 0;
  }

  /** Every game a side already has on a day, so nobody is drawn twice at once. */
  forTeamOn(teamId: number, playedOn: string, exceptId?: number): Fixture[] {
    const found = asRows<FixtureRow>(
      this.db
        .prepare(
          `SELECT * FROM fixtures
            WHERE played_on = ?
              AND (home_team_id = ? OR away_team_id = ?)
              AND status IN ('scheduled', 'played', 'awarded')
              AND (? IS NULL OR id != ?)`,
        )
        .all(playedOn, teamId, teamId, exceptId ?? null, exceptId ?? 0),
    );
    return found.map(toFixture);
  }

  list(filter: FixtureFilter): Fixture[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.divisionId !== undefined) {
      where.push('division_id = ?');
      args.push(filter.divisionId);
    }
    if (filter.teamId !== undefined) {
      where.push('(home_team_id = ? OR away_team_id = ?)');
      args.push(filter.teamId, filter.teamId);
    }
    if (filter.venueId !== undefined) {
      where.push('venue_id = ?');
      args.push(filter.venueId);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.playedOn !== undefined) {
      where.push('played_on = ?');
      args.push(filter.playedOn);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<FixtureRow>(
      this.db
        .prepare(
          `SELECT * FROM fixtures ${clause}
            ORDER BY played_on ASC, kick_off ASC, id ASC`,
        )
        .all(...(args as [])),
    );
    return found.map(toFixture);
  }

  update(id: number, changes: FixtureChanges): Fixture {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.venueId !== undefined) put('venue_id', changes.venueId);
    if (changes.playedOn !== undefined) put('played_on', changes.playedOn);
    if (changes.kickOff !== undefined) put('kick_off', changes.kickOff);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.postponedOn !== undefined) put('postponed_on', changes.postponedOn);
    if (changes.awardedToTeamId !== undefined) put('awarded_to_team_id', changes.awardedToTeamId);
    if (changes.awardReason !== undefined) put('award_reason', changes.awardReason);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Fixture;
  }
}
