/** What a caller may send to the division routes. */
import { z } from 'zod';
import {
  BOTTOM_TIER,
  DIVISION_STATUSES,
  MAX_TEAM_CAPACITY,
  MIN_TEAM_CAPACITY,
  TOP_TIER,
} from './division.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const divisionNameField = z.string().trim().min(3).max(60);
export const tierField = z.number().int().min(TOP_TIER).max(BOTTOM_TIER);
export const capacityField = z.number().int().min(MIN_TEAM_CAPACITY).max(MAX_TEAM_CAPACITY);
export const placesField = z.number().int().min(0).max(6);

export const createDivisionBody = z
  .object({
    name: divisionNameField,
    tier: tierField,
    teamCapacity: capacityField,
    promotionPlaces: placesField,
    relegationPlaces: placesField,
  })
  .strict();

export const updateDivisionBody = z
  .object({
    name: divisionNameField.optional(),
    teamCapacity: capacityField.optional(),
    promotionPlaces: placesField.optional(),
    relegationPlaces: placesField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const fixDivisionBody = z.object({ fixedOn: dayField }).strict();
export const completeDivisionBody = z.object({ completedOn: dayField }).strict();

export const seasonIdParams = z.object({ seasonId: z.coerce.number().int().positive() }).strict();

export const divisionIdParams = z
  .object({ divisionId: z.coerce.number().int().positive() })
  .strict();

export const listDivisionsQuery = z
  .object({
    status: z.enum(DIVISION_STATUSES).optional(),
    tier: z.coerce.number().int().min(TOP_TIER).max(BOTTOM_TIER).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type CreateDivisionBody = z.infer<typeof createDivisionBody>;
export type UpdateDivisionBody = z.infer<typeof updateDivisionBody>;
export type FixDivisionBody = z.infer<typeof fixDivisionBody>;
export type CompleteDivisionBody = z.infer<typeof completeDivisionBody>;
export type ListDivisionsQuery = z.infer<typeof listDivisionsQuery>;
