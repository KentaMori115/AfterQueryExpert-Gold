/** SQL for clubs, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toClub, type Club, type ClubRow, type ClubStatus } from './club.types';

export interface NewClub {
  name: string;
  shortName: string;
  foundedYear: number;
  contactEmail: string;
  homeVenueId: number | null;
  appliedOn: string;
}

export interface ClubChanges {
  name?: string;
  contactEmail?: string;
  homeVenueId?: number | null;
  status?: ClubStatus;
  admittedOn?: string | null;
  leftOn?: string | null;
}

export interface ClubFilter {
  status?: ClubStatus;
  homeVenueId?: number;
}

export class ClubRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewClub): Club {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO clubs
           (name, short_name, founded_year, contact_email, home_venue_id,
            status, applied_on, admitted_on, left_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'applied', ?, NULL, NULL, ?, ?)`,
      )
      .run(
        input.name,
        input.shortName,
        input.foundedYear,
        input.contactEmail,
        input.homeVenueId,
        input.appliedOn,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Club;
  }

  byId(id: number): Club | undefined {
    const row = asRow<ClubRow>(this.db.prepare(`SELECT * FROM clubs WHERE id = ?`).get(id));
    return row ? toClub(row) : undefined;
  }

  byName(name: string): Club | undefined {
    const row = asRow<ClubRow>(this.db.prepare(`SELECT * FROM clubs WHERE name = ?`).get(name));
    return row ? toClub(row) : undefined;
  }

  byShortName(shortName: string): Club | undefined {
    const row = asRow<ClubRow>(
      this.db.prepare(`SELECT * FROM clubs WHERE short_name = ?`).get(shortName),
    );
    return row ? toClub(row) : undefined;
  }

  list(filter: ClubFilter): Club[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.homeVenueId !== undefined) {
      where.push('home_venue_id = ?');
      args.push(filter.homeVenueId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<ClubRow>(
      this.db
        .prepare(`SELECT * FROM clubs ${clause} ORDER BY name ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toClub);
  }

  update(id: number, changes: ClubChanges): Club {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.name !== undefined) put('name', changes.name);
    if (changes.contactEmail !== undefined) put('contact_email', changes.contactEmail);
    if (changes.homeVenueId !== undefined) put('home_venue_id', changes.homeVenueId);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.admittedOn !== undefined) put('admitted_on', changes.admittedOn);
    if (changes.leftOn !== undefined) put('left_on', changes.leftOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE clubs SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Club;
  }
}
