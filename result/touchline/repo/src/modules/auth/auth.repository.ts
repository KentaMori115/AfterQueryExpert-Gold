/**
 * SQL for staff and their sessions, and nothing else.
 *
 * No rule about who may sign in or how long a session lasts lives here; this
 * only knows how to put a row in and take one out.
 */
import type { Database } from '../../db/client';
import { asRow, asRows, now } from '../../db/client';
import {
  toSession,
  toStaff,
  type Session,
  type SessionRow,
  type Staff,
  type StaffRole,
  type StaffRow,
} from './auth.types';

export interface NewStaff {
  email: string;
  fullName: string;
  role: StaffRole;
  password: string;
}

export interface StaffChanges {
  fullName?: string;
  role?: StaffRole;
  active?: boolean;
}

export interface StaffFilter {
  role?: StaffRole;
  active?: boolean;
}

export class AuthRepository {
  constructor(private readonly db: Database) {}

  insertStaff(input: NewStaff): Staff {
    const stamp = now();
    const result = this.db
      .prepare(
        `INSERT INTO staff (email, full_name, role, password, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(input.email, input.fullName, input.role, input.password, stamp, stamp);
    return this.staffById(Number(result.lastInsertRowid)) as Staff;
  }

  staffById(id: number): Staff | undefined {
    const row = asRow<StaffRow>(this.db.prepare(`SELECT * FROM staff WHERE id = ?`).get(id));
    return row ? toStaff(row) : undefined;
  }

  staffByEmail(email: string): Staff | undefined {
    const row = asRow<StaffRow>(this.db.prepare(`SELECT * FROM staff WHERE email = ?`).get(email));
    return row ? toStaff(row) : undefined;
  }

  /** The stored password material, kept apart from the domain shape so it never leaks into a response. */
  passwordFor(id: number): string | undefined {
    const row = asRow<{ password: string }>(
      this.db.prepare(`SELECT password FROM staff WHERE id = ?`).get(id),
    );
    return row?.password;
  }

  listStaff(filter: StaffFilter): Staff[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.role !== undefined) {
      where.push('role = ?');
      args.push(filter.role);
    }
    if (filter.active !== undefined) {
      where.push('active = ?');
      args.push(filter.active ? 1 : 0);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<StaffRow>(
      this.db
        .prepare(`SELECT * FROM staff ${clause} ORDER BY full_name ASC, id ASC`)
        .all(...(args as [])),
    );
    return found.map(toStaff);
  }

  updateStaff(id: number, changes: StaffChanges): Staff {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (changes.fullName !== undefined) {
      sets.push('full_name = ?');
      args.push(changes.fullName);
    }
    if (changes.role !== undefined) {
      sets.push('role = ?');
      args.push(changes.role);
    }
    if (changes.active !== undefined) {
      sets.push('active = ?');
      args.push(changes.active ? 1 : 0);
    }
    sets.push('updated_at = ?');
    args.push(now());
    args.push(id);
    this.db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...(args as []));
    return this.staffById(id) as Staff;
  }

  insertSession(staffId: number, token: string, issuedAt: string, expiresAt: string): Session {
    const result = this.db
      .prepare(
        `INSERT INTO sessions (staff_id, token, issued_at, expires_at, ended_at)
         VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(staffId, token, issuedAt, expiresAt);
    return this.sessionById(Number(result.lastInsertRowid)) as Session;
  }

  sessionById(id: number): Session | undefined {
    const row = asRow<SessionRow>(this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id));
    return row ? toSession(row) : undefined;
  }

  sessionByToken(token: string): Session | undefined {
    const row = asRow<SessionRow>(
      this.db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token),
    );
    return row ? toSession(row) : undefined;
  }

  endSession(id: number, endedAt: string): void {
    this.db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(endedAt, id);
  }
}
