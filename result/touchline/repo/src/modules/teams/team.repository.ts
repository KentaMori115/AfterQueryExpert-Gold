/** SQL for teams, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import { toTeam, type Team, type TeamRank, type TeamRow, type TeamStatus } from './team.types';

export interface NewTeam {
  clubId: number;
  divisionId: number;
  rank: TeamRank;
  enteredOn: string;
}

export interface TeamChanges {
  divisionId?: number;
  status?: TeamStatus;
  withdrawnOn?: string | null;
}

export interface TeamFilter {
  clubId?: number;
  divisionId?: number;
  rank?: TeamRank;
  status?: TeamStatus;
}

export class TeamRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewTeam): Team {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO teams
           (club_id, division_id, rank, status, entered_on, withdrawn_on, created_at, updated_at)
         VALUES (?, ?, ?, 'entered', ?, NULL, ?, ?)`,
      )
      .run(input.clubId, input.divisionId, input.rank, input.enteredOn, stamp, stamp);
    return this.byId(Number(result.lastInsertRowid)) as Team;
  }

  byId(id: number): Team | undefined {
    const row = asRow<TeamRow>(this.db.prepare(`SELECT * FROM teams WHERE id = ?`).get(id));
    return row ? toTeam(row) : undefined;
  }

  /** The team a club has at a given rank in a given season, whatever division it sits in. */
  byClubAndRankInSeason(clubId: number, rank: TeamRank, seasonId: number): Team | undefined {
    const row = asRow<TeamRow>(
      this.db
        .prepare(
          `SELECT t.* FROM teams t
             JOIN divisions d ON d.id = t.division_id
            WHERE t.club_id = ? AND t.rank = ? AND d.season_id = ?`,
        )
        .get(clubId, rank, seasonId),
    );
    return row ? toTeam(row) : undefined;
  }

  /** Every team a club has entered in a season, in seniority order. */
  forClubInSeason(clubId: number, seasonId: number): Team[] {
    const found = asRows<TeamRow>(
      this.db
        .prepare(
          `SELECT t.* FROM teams t
             JOIN divisions d ON d.id = t.division_id
            WHERE t.club_id = ? AND d.season_id = ?
            ORDER BY t.id ASC`,
        )
        .all(clubId, seasonId),
    );
    return found.map(toTeam);
  }

  countEnteredIn(divisionId: number): number {
    const row = asRow<{ n: number }>(
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM teams WHERE division_id = ? AND status = 'entered'`)
        .get(divisionId),
    );
    return row?.n ?? 0;
  }

  list(filter: TeamFilter): Team[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.clubId !== undefined) {
      where.push('club_id = ?');
      args.push(filter.clubId);
    }
    if (filter.divisionId !== undefined) {
      where.push('division_id = ?');
      args.push(filter.divisionId);
    }
    if (filter.rank !== undefined) {
      where.push('rank = ?');
      args.push(filter.rank);
    }
    if (filter.status !== undefined) {
      where.push('status = ?');
      args.push(filter.status);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<TeamRow>(
      this.db
        .prepare(`SELECT * FROM teams ${clause} ORDER BY club_id ASC, rank ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toTeam);
  }

  update(id: number, changes: TeamChanges): Team {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (changes.divisionId !== undefined) put('division_id', changes.divisionId);
    if (changes.status !== undefined) put('status', changes.status);
    if (changes.withdrawnOn !== undefined) put('withdrawn_on', changes.withdrawnOn);
    put('updated_at', now());
    args.push(id);
    this.db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.byId(id) as Team;
  }
}
