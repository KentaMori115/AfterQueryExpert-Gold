/** SQL for the audit trail, and nothing else. */
import { asRow, asRows, now, type Database } from '../../db/client';
import {
  toAuditEntry,
  type AuditEntry,
  type AuditOutcome,
  type AuditRow,
  type AuditedMethod,
} from './audit.types';

export interface NewEntry {
  staffId: number | null;
  method: string;
  path: string;
  status: number;
  outcome: AuditOutcome;
  bodyKeys: string[];
}

export interface AuditFilter {
  staffId?: number;
  method?: AuditedMethod;
  outcome?: AuditOutcome;
  path?: string;
}

export class AuditRepository {
  constructor(private readonly db: Database) {}

  insert(input: NewEntry): AuditEntry {
    const result = this.db
      .prepare(
        `INSERT INTO audit_entries
           (staff_id, method, path, status, outcome, body_keys, happened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.staffId,
        input.method,
        input.path,
        input.status,
        input.outcome,
        JSON.stringify(input.bodyKeys),
        now(),
      );
    return this.byId(Number(result.lastInsertRowid)) as AuditEntry;
  }

  byId(id: number): AuditEntry | undefined {
    const row = asRow<AuditRow>(
      this.db.prepare(`SELECT * FROM audit_entries WHERE id = ?`).get(id),
    );
    return row ? toAuditEntry(row) : undefined;
  }

  list(filter: AuditFilter): AuditEntry[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.staffId !== undefined) {
      where.push('staff_id = ?');
      args.push(filter.staffId);
    }
    if (filter.method !== undefined) {
      where.push('method = ?');
      args.push(filter.method);
    }
    if (filter.outcome !== undefined) {
      where.push('outcome = ?');
      args.push(filter.outcome);
    }
    if (filter.path !== undefined) {
      // A prefix, so asking for /clubs brings back everything under it.
      where.push('path LIKE ?');
      args.push(`${filter.path}%`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const found = asRows<AuditRow>(
      this.db
        .prepare(`SELECT * FROM audit_entries ${clause} ORDER BY id DESC`)
        .all(...(args as [])),
    );
    return found.map(toAuditEntry);
  }
}
