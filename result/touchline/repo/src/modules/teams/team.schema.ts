/** What a caller may send to the team routes. */
import { z } from 'zod';
import { TEAM_RANKS, TEAM_STATUSES } from './team.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');

export const enterTeamBody = z
  .object({
    clubId: z.number().int().positive(),
    rank: z.enum(TEAM_RANKS),
    enteredOn: dayField,
  })
  .strict();

export const withdrawTeamBody = z.object({ withdrawnOn: dayField }).strict();

export const moveTeamBody = z
  .object({
    divisionId: z.number().int().positive(),
  })
  .strict();

export const divisionIdParams = z
  .object({ divisionId: z.coerce.number().int().positive() })
  .strict();

export const teamIdParams = z.object({ teamId: z.coerce.number().int().positive() }).strict();

export const listTeamsQuery = z
  .object({
    clubId: z.coerce.number().int().positive().optional(),
    divisionId: z.coerce.number().int().positive().optional(),
    rank: z.enum(TEAM_RANKS).optional(),
    status: z.enum(TEAM_STATUSES).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type EnterTeamBody = z.infer<typeof enterTeamBody>;
export type WithdrawTeamBody = z.infer<typeof withdrawTeamBody>;
export type MoveTeamBody = z.infer<typeof moveTeamBody>;
export type ListTeamsQuery = z.infer<typeof listTeamsQuery>;
