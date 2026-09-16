/** SQL for players, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import {
  toPlayer,
  type Player,
  type PlayerRow,
  type PlayerStatus,
  type Position,
} from './player.types';

export interface NewPlayer {
  clubId: number;
  firstName: string;
  lastName: string;
  bornOn: string;
  position: Position;
  squadNumber: number;
  registeredOn: string;
}

export interface PlayerChanges {
  clubId?: number;
  firstName?: string;
  lastName?: string;
  position?: Position;
  squadNumber?: number;
  status?: PlayerStatus;
  registeredOn?: string;
  releasedOn?: string | null;
}

export interface PlayerFilter {
  clubId?: number;
  position?: Position;
  status?: PlayerStatus;
}

export class PlayerRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewPlayer): Player {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO players
           (club_id, first_name, last_name, born_on, position, squad_number,
            status, registered_on, released_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, NULL, ?, ?)`,
      )
      .run(
        input.clubId,
        input.firstName,
        input.lastName,
        input.bornOn,
        input.position,
        input.squadNumber,
        input.registeredOn,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Player;
  }

  byId(id: number): Player | undefined {
    const row = asRow<PlayerRow>(this.db.prepare(`SELECT * FROM players WHERE id = ?`).get(id));
    return row ? toPlayer(row) : undefined;
  }

  /** The registered player wearing a number at a club, if anybody is. */
  bySquadNumber(clubId: number, squadNumber: number): Player | undefined {
    const row = asRow<PlayerRow>(
      this.db
        .prepare(
          `SELECT * FROM players
            WHERE club_id = ? AND squad_number = ? AND status = 'registered'`,
        )
        .get(clubId, squadNumber),
    );
    return row ? toPlayer(row) : undefined;
  }

  list(filter: PlayerFilter): Player[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.clubId !== undefined) {
      where.push('club_id = ?');
      args.push(filter.clubId);
    }
    if (filter.position !== undefined) {
      where.push('position = ?');
      args.push(filter.position);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<PlayerRow>(
      this.db
        .prepare(
          `SELECT * FROM players ${clause}
            ORDER BY last_name ASC, first_name ASC, id ASC`,
        )
        .all(...(args as [])),
    );
    return found.map(toPlayer);
  }

  update(id: number, changes: PlayerChanges): Player {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.clubId !== undefined) put('club_id', changes.clubId);
    if (changes.firstName !== undefined) put('first_name', changes.firstName);
    if (changes.lastName !== undefined) put('last_name', changes.lastName);
    if (changes.position !== undefined) put('position', changes.position);
    if (changes.squadNumber !== undefined) put('squad_number', changes.squadNumber);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.registeredOn !== undefined) put('registered_on', changes.registeredOn);
    if (changes.releasedOn !== undefined) put('released_on', changes.releasedOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Player;
  }
}
