/** SQL for divisions, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toDivision, type Division, type DivisionRow, type DivisionStatus } from './division.types';

export interface NewDivision {
  seasonId: number;
  name: string;
  tier: number;
  teamCapacity: number;
  promotionPlaces: number;
  relegationPlaces: number;
}

export interface DivisionChanges {
  name?: string;
  teamCapacity?: number;
  promotionPlaces?: number;
  relegationPlaces?: number;
  status?: DivisionStatus;
  fixedOn?: string;
  completedOn?: string;
}

export interface DivisionFilter {
  seasonId?: number;
  status?: DivisionStatus;
  tier?: number;
}

export class DivisionRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewDivision): Division {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO divisions
           (season_id, name, tier, team_capacity, promotion_places, relegation_places,
            status, fixed_on, completed_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'forming', NULL, NULL, ?, ?)`,
      )
      .run(
        input.seasonId,
        input.name,
        input.tier,
        input.teamCapacity,
        input.promotionPlaces,
        input.relegationPlaces,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Division;
  }

  byId(id: number): Division | undefined {
    const row = asRow<DivisionRow>(this.db.prepare(`SELECT * FROM divisions WHERE id = ?`).get(id));
    return row ? toDivision(row) : undefined;
  }

  byNameInSeason(seasonId: number, name: string): Division | undefined {
    const row = asRow<DivisionRow>(
      this.db
        .prepare(`SELECT * FROM divisions WHERE season_id = ? AND name = ?`)
        .get(seasonId, name),
    );
    return row ? toDivision(row) : undefined;
  }

  byTierInSeason(seasonId: number, tier: number): Division | undefined {
    const row = asRow<DivisionRow>(
      this.db
        .prepare(`SELECT * FROM divisions WHERE season_id = ? AND tier = ?`)
        .get(seasonId, tier),
    );
    return row ? toDivision(row) : undefined;
  }

  list(filter: DivisionFilter): Division[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.seasonId !== undefined) {
      where.push('season_id = ?');
      args.push(filter.seasonId);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.tier !== undefined) {
      where.push('tier = ?');
      args.push(filter.tier);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<DivisionRow>(
      this.db
        .prepare(`SELECT * FROM divisions ${clause} ORDER BY tier ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toDivision);
  }

  update(id: number, changes: DivisionChanges): Division {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.name !== undefined) put('name', changes.name);
    if (changes.teamCapacity !== undefined) put('team_capacity', changes.teamCapacity);
    if (changes.promotionPlaces !== undefined) put('promotion_places', changes.promotionPlaces);
    if (changes.relegationPlaces !== undefined) put('relegation_places', changes.relegationPlaces);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.fixedOn !== undefined) put('fixed_on', changes.fixedOn);
    if (changes.completedOn !== undefined) put('completed_on', changes.completedOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE divisions SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Division;
  }
}
