/** Keeping and reading the audit trail. */
import { NotFoundError } from '../../lib/AppError';
import { AuditRepository, type AuditFilter } from './audit.repository';
import { keysOf, outcomeFor, type AuditEntry } from './audit.types';

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  /** Records one attempt. Called after the response is on the wire, never before. */
  record(input: {
    staffId: number | null;
    method: string;
    path: string;
    status: number;
    body: unknown;
  }): AuditEntry {
    return this.repo.insert({
      staffId: input.staffId,
      method: input.method,
      path: input.path,
      status: input.status,
      outcome: outcomeFor(input.status),
      bodyKeys: keysOf(input.body),
    });
  }

  get(entryId: number): AuditEntry {
    const entry = this.repo.byId(entryId);
    if (entry === undefined) throw new NotFoundError(`There is no audit entry ${entryId}`);
    return entry;
  }

  list(filter: AuditFilter): AuditEntry[] {
    return this.repo.list(filter);
  }
}
