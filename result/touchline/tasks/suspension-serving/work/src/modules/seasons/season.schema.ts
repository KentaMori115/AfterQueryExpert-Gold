/**
 * What a caller may send to the season routes.
 *
 * A day is checked here only for its shape. Whether the calendar actually has
 * that day is the service's business, and answers 409 rather than 400.
 */
import { z } from 'zod';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const seasonNameField = z.string().trim().min(4).max(80);

/** Points are whole and bounded: a league that pays 400 for a win has mistyped something. */
export const pointsField = z.number().int().min(0).max(10);

export const createSeasonBody = z
  .object({
    name: seasonNameField,
    startsOn: dayField,
    endsOn: dayField,
    registrationClosesOn: dayField,
    pointsWin: pointsField.optional(),
    pointsDraw: pointsField.optional(),
    pointsLoss: pointsField.optional(),
  })
  .strict();

export const updateSeasonBody = z
  .object({
    name: seasonNameField.optional(),
    endsOn: dayField.optional(),
    registrationClosesOn: dayField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const openSeasonBody = z.object({ openedOn: dayField }).strict();
export const closeSeasonBody = z.object({ closedOn: dayField }).strict();

export const seasonIdParams = z
  .object({
    seasonId: z.coerce.number().int().positive(),
  })
  .strict();

export const listSeasonsQuery = z
  .object({
    status: z.enum(['planning', 'running', 'closed']).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type CreateSeasonBody = z.infer<typeof createSeasonBody>;
export type UpdateSeasonBody = z.infer<typeof updateSeasonBody>;
export type OpenSeasonBody = z.infer<typeof openSeasonBody>;
export type CloseSeasonBody = z.infer<typeof closeSeasonBody>;
export type ListSeasonsQuery = z.infer<typeof listSeasonsQuery>;
