/** What a caller may send to the venue routes. */
import { z } from 'zod';
import { MAX_PITCHES, MIN_PITCHES, SURFACES } from './venue.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const venueNameField = z.string().trim().min(3).max(90);
export const addressField = z.string().trim().min(5).max(160);

/** A UK postcode, loosely: the league only needs it to be sortable and printable. */
export const postcodeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/, 'must read like SW1A 1AA');

export const pitchCountField = z.number().int().min(MIN_PITCHES).max(MAX_PITCHES);

export const createVenueBody = z
  .object({
    name: venueNameField,
    addressLine: addressField,
    postcode: postcodeField,
    surface: z.enum(SURFACES),
    pitchCount: pitchCountField,
    floodlit: z.boolean(),
  })
  .strict();

export const updateVenueBody = z
  .object({
    name: venueNameField.optional(),
    addressLine: addressField.optional(),
    surface: z.enum(SURFACES).optional(),
    pitchCount: pitchCountField.optional(),
    floodlit: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const closeVenueBody = z.object({ closedOn: dayField }).strict();

export const venueIdParams = z.object({ venueId: z.coerce.number().int().positive() }).strict();

export const listVenuesQuery = z
  .object({
    surface: z.enum(SURFACES).optional(),
    status: z.enum(['open', 'closed']).optional(),
    floodlit: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type CreateVenueBody = z.infer<typeof createVenueBody>;
export type UpdateVenueBody = z.infer<typeof updateVenueBody>;
export type CloseVenueBody = z.infer<typeof closeVenueBody>;
export type ListVenuesQuery = z.infer<typeof listVenuesQuery>;
