/** SQL for results, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toResult, type Result, type ResultRow, type ResultStatus } from './result.types';

export interface NewResult {
  fixtureId: number;
  homeGoals: number;
  awayGoals: number;
  reportedByTeamId: number;
  reportedOn: string;
}

export interface ResultChanges {
  homeGoals?: number;
  awayGoals?: number;
  status?: ResultStatus;
  answeredByTeamId?: number | null;
  answeredOn?: string | null;
  settledOn?: string | null;
  note?: string | null;
}

export interface ResultFilter {
  divisionId?: number;
  teamId?: number;
  status?: ResultStatus;
}

export class ResultRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewResult): Result {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO results
           (fixture_id, home_goals, away_goals, reported_by_team_id, reported_on,
            status, answered_by_team_id, answered_on, settled_on, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'reported', NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        input.fixtureId,
        input.homeGoals,
        input.awayGoals,
        input.reportedByTeamId,
        input.reportedOn,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Result;
  }

  byId(id: number): Result | undefined {
    const row = asRow<ResultRow>(this.db.prepare(`SELECT * FROM results WHERE id = ?`).get(id));
    return row ? toResult(row) : undefined;
  }

  byFixture(fixtureId: number): Result | undefined {
    const row = asRow<ResultRow>(
      this.db.prepare(`SELECT * FROM results WHERE fixture_id = ?`).get(fixtureId),
    );
    return row ? toResult(row) : undefined;
  }

  /** Every confirmed result in a division, which is what the table is built from. */
  confirmedInDivision(divisionId: number): Result[] {
    const found = asRows<ResultRow>(
      this.db
        .prepare(
          `SELECT r.* FROM results r
             JOIN fixtures f ON f.id = r.fixture_id
            WHERE f.division_id = ? AND r.status = 'confirmed'
            ORDER BY f.played_on ASC, f.kick_off ASC, r.id ASC`,
        )
        .all(divisionId),
    );
    return found.map(toResult);
  }

  list(filter: ResultFilter): Result[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.divisionId !== undefined) {
      where.push('f.division_id = ?');
      args.push(filter.divisionId);
    }
    if (filter.teamId !== undefined) {
      where.push('(f.home_team_id = ? OR f.away_team_id = ?)');
      args.push(filter.teamId, filter.teamId);
    }
    if (filter.status !== undefined) {
      where.push('r.status = ?');
      args.push(filter.status);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<ResultRow>(
      this.db
        .prepare(
          `SELECT r.* FROM results r
             JOIN fixtures f ON f.id = r.fixture_id
            ${clause}
            ORDER BY f.played_on ASC, f.kick_off ASC, r.id ASC`,
        )
        .all(...(args as [])),
    );
    return found.map(toResult);
  }

  update(id: number, changes: ResultChanges): Result {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.homeGoals !== undefined) put('home_goals', changes.homeGoals);
    if (changes.awayGoals !== undefined) put('away_goals', changes.awayGoals);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.answeredByTeamId !== undefined)
      put('answered_by_team_id', changes.answeredByTeamId);
    if (changes.answeredOn !== undefined) put('answered_on', changes.answeredOn);
    if (changes.settledOn !== undefined) put('settled_on', changes.settledOn);
    if (changes.note !== undefined) put('note', changes.note);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE results SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Result;
  }
}
