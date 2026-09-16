/** What a caller may send to the audit routes. */
import { z } from 'zod';
import { AUDITED_METHODS, AUDIT_OUTCOMES } from './audit.types';

export const entryIdParams = z.object({ entryId: z.coerce.number().int().positive() }).strict();

export const listAuditQuery = z
  .object({
    staffId: z.coerce.number().int().positive().optional(),
    method: z.enum(AUDITED_METHODS).optional(),
    outcome: z.enum(AUDIT_OUTCOMES).optional(),
    path: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type ListAuditQuery = z.infer<typeof listAuditQuery>;
