/** What a caller may send to the club routes. */
import { z } from 'zod';
import { CLUB_STATUSES, EARLIEST_FOUNDED_YEAR, LATEST_FOUNDED_YEAR } from './club.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const clubNameField = z.string().trim().min(3).max(90);

/** The three or four letters that appear on a scoreboard. */
export const shortNameField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,4}$/, 'must be three or four letters');

export const foundedYearField = z
  .number()
  .int()
  .min(EARLIEST_FOUNDED_YEAR)
  .max(LATEST_FOUNDED_YEAR);

export const createClubBody = z
  .object({
    name: clubNameField,
    shortName: shortNameField,
    foundedYear: foundedYearField,
    contactEmail: z.string().trim().email().max(160),
    appliedOn: dayField,
    homeVenueId: z.number().int().positive().optional(),
  })
  .strict();

export const updateClubBody = z
  .object({
    name: clubNameField.optional(),
    contactEmail: z.string().trim().email().max(160).optional(),
    homeVenueId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const admitClubBody = z.object({ admittedOn: dayField }).strict();
export const suspendClubBody = z.object({ suspendedOn: dayField }).strict();
export const reinstateClubBody = z.object({ reinstatedOn: dayField }).strict();
export const resignClubBody = z.object({ leftOn: dayField }).strict();

export const clubIdParams = z.object({ clubId: z.coerce.number().int().positive() }).strict();

export const listClubsQuery = z
  .object({
    status: z.enum(CLUB_STATUSES).optional(),
    homeVenueId: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type CreateClubBody = z.infer<typeof createClubBody>;
export type UpdateClubBody = z.infer<typeof updateClubBody>;
export type AdmitClubBody = z.infer<typeof admitClubBody>;
export type SuspendClubBody = z.infer<typeof suspendClubBody>;
export type ReinstateClubBody = z.infer<typeof reinstateClubBody>;
export type ResignClubBody = z.infer<typeof resignClubBody>;
export type ListClubsQuery = z.infer<typeof listClubsQuery>;
