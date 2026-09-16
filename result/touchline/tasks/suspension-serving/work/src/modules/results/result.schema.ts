/** What a caller may send to the result routes. */
import { z } from 'zod';
import { MAX_GOALS, MIN_GOALS, RESULT_STATUSES } from './result.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const goalsField = z.number().int().min(MIN_GOALS).max(MAX_GOALS);
export const noteField = z.string().trim().min(4).max(300);

export const reportResultBody = z
  .object({
    homeGoals: goalsField,
    awayGoals: goalsField,
    reportedByTeamId: z.number().int().positive(),
    reportedOn: dayField,
  })
  .strict();

export const confirmResultBody = z
  .object({
    confirmedByTeamId: z.number().int().positive(),
    confirmedOn: dayField,
  })
  .strict();

export const disputeResultBody = z
  .object({
    disputedByTeamId: z.number().int().positive(),
    disputedOn: dayField,
    note: noteField,
  })
  .strict();

export const settleResultBody = z
  .object({
    settledOn: dayField,
    homeGoals: goalsField,
    awayGoals: goalsField,
  })
  .strict();

export const fixtureIdParams = z.object({ fixtureId: z.coerce.number().int().positive() }).strict();
export const resultIdParams = z.object({ resultId: z.coerce.number().int().positive() }).strict();

export const listResultsQuery = z
  .object({
    divisionId: z.coerce.number().int().positive().optional(),
    teamId: z.coerce.number().int().positive().optional(),
    status: z.enum(RESULT_STATUSES).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type ReportResultBody = z.infer<typeof reportResultBody>;
export type ConfirmResultBody = z.infer<typeof confirmResultBody>;
export type DisputeResultBody = z.infer<typeof disputeResultBody>;
export type SettleResultBody = z.infer<typeof settleResultBody>;
export type ListResultsQuery = z.infer<typeof listResultsQuery>;
