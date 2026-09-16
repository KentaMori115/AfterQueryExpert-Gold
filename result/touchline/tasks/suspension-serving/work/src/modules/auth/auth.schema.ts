/**
 * What a caller may send to the sign-in and staff routes.
 *
 * Every body and every query is strict, so a misspelled field is refused rather
 * than quietly dropped.
 */
import { z } from 'zod';
import { STAFF_ROLES } from './auth.types';

export const emailField = z.string().trim().min(5).max(160).email();
export const passwordField = z.string().min(10).max(200);
export const nameField = z.string().trim().min(2).max(120);

export const signInBody = z
  .object({
    email: emailField,
    password: passwordField,
  })
  .strict();

export const createStaffBody = z
  .object({
    email: emailField,
    fullName: nameField,
    role: z.enum(STAFF_ROLES),
    password: passwordField,
  })
  .strict();

export const updateStaffBody = z
  .object({
    fullName: nameField.optional(),
    role: z.enum(STAFF_ROLES).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const staffIdParams = z
  .object({
    staffId: z.coerce.number().int().positive(),
  })
  .strict();

export const listStaffQuery = z
  .object({
    role: z.enum(STAFF_ROLES).optional(),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

/** Sign-out and "who am I" take no query of their own, and still refuse one. */
export const noQuery = z.object({}).strict();

export type SignInBody = z.infer<typeof signInBody>;
export type CreateStaffBody = z.infer<typeof createStaffBody>;
export type UpdateStaffBody = z.infer<typeof updateStaffBody>;
export type ListStaffQuery = z.infer<typeof listStaffQuery>;
