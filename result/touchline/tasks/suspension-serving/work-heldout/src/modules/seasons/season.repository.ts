/** SQL for seasons, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toSeason, type Season, type SeasonRow, type SeasonStatus } from './season.types';

export interface NewSeason {
  name: string;
  startsOn: string;
  endsOn: string;
  registrationClosesOn: string;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
}

export interface SeasonChanges {
  name?: string;
  endsOn?: string;
  registrationClosesOn?: string;
  status?: SeasonStatus;
  openedOn?: string;
  closedOn?: string;
}

export class SeasonRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewSeason): Season {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO seasons
           (name, starts_on, ends_on, registration_closes_on, status,
            points_win, points_draw, points_loss, opened_on, closed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'planning', ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.name,
        input.startsOn,
        input.endsOn,
        input.registrationClosesOn,
        input.pointsWin,
        input.pointsDraw,
        input.pointsLoss,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Season;
  }

  byId(id: number): Season | undefined {
    const row = asRow<SeasonRow>(this.db.prepare(`SELECT * FROM seasons WHERE id = ?`).get(id));
    return row ? toSeason(row) : undefined;
  }

  byName(name: string): Season | undefined {
    const row = asRow<SeasonRow>(this.db.prepare(`SELECT * FROM seasons WHERE name = ?`).get(name));
    return row ? toSeason(row) : undefined;
  }

  list(filter: { status?: SeasonStatus }): Season[] {
    const clause = filter.status !== undefined ? 'WHERE status = ?' : '';
    const args = filter.status !== undefined ? [filter.status] : [];
    const found = asRows<SeasonRow>(
      this.db
        .prepare(`SELECT * FROM seasons ${clause} ORDER BY starts_on DESC, id DESC`)
        .all(...(args as [])),
    );
    return found.map(toSeason);
  }

  /** Every season whose window overlaps the given one, ignoring one id when re-checking. */
  overlapping(startsOn: string, endsOn: string, exceptId?: number): Season[] {
    const found = asRows<SeasonRow>(
      this.db
        .prepare(
          `SELECT * FROM seasons
            WHERE starts_on <= ? AND ends_on >= ?
              AND (? IS NULL OR id != ?)
            ORDER BY starts_on ASC, id ASC`,
        )
        .all(endsOn, startsOn, exceptId ?? null, exceptId ?? 0),
    );
    return found.map(toSeason);
  }

  update(id: number, changes: SeasonChanges): Season {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.name !== undefined) put('name', changes.name);
    if (changes.endsOn !== undefined) put('ends_on', changes.endsOn);
    if (changes.registrationClosesOn !== undefined) {
      put('registration_closes_on', changes.registrationClosesOn);
    }
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.openedOn !== undefined) put('opened_on', changes.openedOn);
    if (changes.closedOn !== undefined) put('closed_on', changes.closedOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Season;
  }
}
