/** SQL for cards, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import {
  toCard,
  type Card,
  type CardColour,
  type CardRow,
  type DisciplineStatus,
  type Offence,
} from './discipline.types';

export interface NewCard {
  fixtureId: number;
  playerId: number;
  teamId: number;
  offence: Offence;
  colour: CardColour;
  points: number;
  finePence: number;
  straightBan: number;
  accumulationBan: number;
  runningPoints: number;
  shownOn: string;
}

export interface CardChanges {
  status?: DisciplineStatus;
  rescindedOn?: string | null;
}

export interface CardFilter {
  playerId?: number;
  teamId?: number;
  fixtureId?: number;
  colour?: CardColour;
  status?: DisciplineStatus;
}

export class DisciplineRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewCard): Card {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO cards
           (fixture_id, player_id, team_id, offence, colour, points, fine_pence,
            straight_ban, accumulation_ban, running_points, status, shown_on,
            rescinded_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, NULL, ?, ?)`,
      )
      .run(
        input.fixtureId,
        input.playerId,
        input.teamId,
        input.offence,
        input.colour,
        input.points,
        input.finePence,
        input.straightBan,
        input.accumulationBan,
        input.runningPoints,
        input.shownOn,
        stamp,
        stamp,
      );
    return this.byId(Number(result.lastInsertRowid)) as Card;
  }

  byId(id: number): Card | undefined {
    const row = asRow<CardRow>(this.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id));
    return row ? toCard(row) : undefined;
  }

  /** A player's standing cards on or before a day, oldest first, which is the order they accumulated in. */
  forPlayerUpTo(playerId: number, asOf: string): Card[] {
    const found = asRows<CardRow>(
      this.db
        .prepare(
          `SELECT * FROM cards
            WHERE player_id = ? AND status = 'recorded' AND shown_on <= ?
            ORDER BY shown_on ASC, id ASC`,
        )
        .all(playerId, asOf),
    );
    return found.map(toCard);
  }

  /** Every standing card a player has, in the order they were shown. */
  forPlayer(playerId: number): Card[] {
    const found = asRows<CardRow>(
      this.db
        .prepare(
          `SELECT * FROM cards
            WHERE player_id = ? AND status = 'recorded'
            ORDER BY shown_on ASC, id ASC`,
        )
        .all(playerId),
    );
    return found.map(toCard);
  }

  /** Whether this player already has a card of this colour in this game. */
  inFixture(fixtureId: number, playerId: number): Card[] {
    const found = asRows<CardRow>(
      this.db
        .prepare(
          `SELECT * FROM cards
            WHERE fixture_id = ? AND player_id = ? AND status = 'recorded'
            ORDER BY id ASC`,
        )
        .all(fixtureId, playerId),
    );
    return found.map(toCard);
  }

  list(filter: CardFilter): Card[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.playerId !== undefined) {
      where.push('player_id = ?');
      args.push(filter.playerId);
    }
    if (filter.teamId !== undefined) {
      where.push('team_id = ?');
      args.push(filter.teamId);
    }
    if (filter.fixtureId !== undefined) {
      where.push('fixture_id = ?');
      args.push(filter.fixtureId);
    }
    if (filter.colour !== undefined) {
      where.push('colour = ?');
      args.push(filter.colour);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<CardRow>(
      this.db
        .prepare(`SELECT * FROM cards ${clause} ORDER BY shown_on ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toCard);
  }

  /**
   * Rewrites what a card turned out to be worth after an earlier one was taken
   * off the record. Only the derived figures move; the offence and its own
   * points are what the referee gave and do not change.
   */
  rewrite(id: number, runningPoints: number, accumulationBan: number): Card {
    this.db
      .prepare(
        `UPDATE cards SET running_points = ?, accumulation_ban = ?, updated_at = ? WHERE id = ?`,
      )
      .run(runningPoints, accumulationBan, now(), id);
    return this.byId(id) as Card;
  }

  update(id: number, changes: CardChanges): Card {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.rescindedOn !== undefined) put('rescinded_on', changes.rescindedOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Card;
  }
}
