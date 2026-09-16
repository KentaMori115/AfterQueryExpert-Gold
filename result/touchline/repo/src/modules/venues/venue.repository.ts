/** SQL for venues, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toVenue, type Surface, type Venue, type VenueRow, type VenueStatus } from './venue.types';

export interface NewVenue {
  name: string;
  addressLine: string;
  postcode: string;
  surface: Surface;
  pitchCount: number;
  floodlit: boolean;
}

export interface VenueChanges {
  name?: string;
  addressLine?: string;
  surface?: Surface;
  pitchCount?: number;
  floodlit?: boolean;
  status?: VenueStatus;
  closedOn?: string | null;
}

export interface VenueFilter {
  surface?: Surface;
  status?: VenueStatus;
  floodlit?: boolean;
}

export class VenueRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewVenue): Venue {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO venues
           (name, address_line, postcode, surface, pitch_count, floodlit, status, closed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)`,
      )
      .run(
        input.name,
        input.addressLine,
        input.postcode,
        input.surface,
        input.pitchCount,
        input.floodlit ? 1 : 0,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Venue;
  }

  byId(id: number): Venue | undefined {
    const row = asRow<VenueRow>(this.db.prepare(`SELECT * FROM venues WHERE id = ?`).get(id));
    return row ? toVenue(row) : undefined;
  }

  byNameAndPostcode(name: string, postcode: string): Venue | undefined {
    const row = asRow<VenueRow>(
      this.db.prepare(`SELECT * FROM venues WHERE name = ? AND postcode = ?`).get(name, postcode),
    );
    return row ? toVenue(row) : undefined;
  }

  list(filter: VenueFilter): Venue[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.surface !== undefined) {
      where.push('surface = ?');
      args.push(filter.surface);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.floodlit !== undefined) {
      where.push('floodlit = ?');
      args.push(filter.floodlit ? 1 : 0);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<VenueRow>(
      this.db
        .prepare(`SELECT * FROM venues ${clause} ORDER BY name ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toVenue);
  }

  update(id: number, changes: VenueChanges): Venue {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.name !== undefined) put('name', changes.name);
    if (changes.addressLine !== undefined) put('address_line', changes.addressLine);
    if (changes.surface !== undefined) put('surface', changes.surface);
    if (changes.pitchCount !== undefined) put('pitch_count', changes.pitchCount);
    if (changes.floodlit !== undefined) put('floodlit', changes.floodlit ? 1 : 0);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.closedOn !== undefined) put('closed_on', changes.closedOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Venue;
  }
}
