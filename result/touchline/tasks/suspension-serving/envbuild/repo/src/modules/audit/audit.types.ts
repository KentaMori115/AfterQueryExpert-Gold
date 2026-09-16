/**
 * A line per write, kept whether or not the write succeeded.
 *
 * The refused attempts are the ones worth having. A league secretary asking why
 * a club's registration never went through wants to see the four attempts that
 * came back 409, not just the fifth that worked.
 *
 * What is deliberately NOT kept: the request body. Sign-in bodies carry
 * passwords, and an audit trail that quietly stores them is worse than no trail
 * at all. The field NAMES are kept, which is enough to see what was attempted.
 */

export const AUDIT_OUTCOMES = ['accepted', 'refused', 'failed'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** The methods that change something and are therefore worth a line. */
export const AUDITED_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'] as const;
export type AuditedMethod = (typeof AUDITED_METHODS)[number];

export interface AuditRow {
  id: number;
  staff_id: number | null;
  method: string;
  path: string;
  status: number;
  outcome: string;
  body_keys: string;
  happened_at: string;
}

export interface AuditEntry {
  id: number;
  staffId: number | null;
  method: string;
  path: string;
  status: number;
  outcome: AuditOutcome;
  bodyKeys: string[];
  happenedAt: string;
}

export function isAuditedMethod(method: string): method is AuditedMethod {
  return (AUDITED_METHODS as readonly string[]).includes(method);
}

/** How a response status reads as an outcome. */
export function outcomeFor(status: number): AuditOutcome {
  if (status >= 500) return 'failed';
  if (status >= 400) return 'refused';
  return 'accepted';
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  let bodyKeys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.body_keys);
    if (Array.isArray(parsed))
      bodyKeys = parsed.filter((key): key is string => typeof key === 'string');
  } catch {
    bodyKeys = [];
  }
  return {
    id: row.id,
    staffId: row.staff_id,
    method: row.method,
    path: row.path,
    status: row.status,
    outcome: (AUDIT_OUTCOMES as readonly string[]).includes(row.outcome)
      ? (row.outcome as AuditOutcome)
      : 'failed',
    bodyKeys,
    happenedAt: row.happened_at,
  };
}

/** The field names of a body, sorted so two identical attempts read identically. */
export function keysOf(body: unknown): string[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>).sort();
}
