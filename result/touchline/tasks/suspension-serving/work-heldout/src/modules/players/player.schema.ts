/** What a caller may send to the player routes. */
import { z } from 'zod';
import { MAX_SQUAD_NUMBER, MIN_SQUAD_NUMBER, PLAYER_STATUSES, POSITIONS } from './player.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');
export const nameField = z.string().trim().min(2).max(60);
export const squadNumberField = z.number().int().min(MIN_SQUAD_NUMBER).max(MAX_SQUAD_NUMBER);

export const registerPlayerBody = z
  .object({
    firstName: nameField,
    lastName: nameField,
    bornOn: dayField,
    position: z.enum(POSITIONS),
    squadNumber: squadNumberField,
    registeredOn: dayField,
  })
  .strict();

export const updatePlayerBody = z
  .object({
    firstName: nameField.optional(),
    lastName: nameField.optional(),
    position: z.enum(POSITIONS).optional(),
    squadNumber: squadNumberField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one field to change',
  });

export const releasePlayerBody = z.object({ releasedOn: dayField }).strict();

export const transferPlayerBody = z
  .object({
    clubId: z.number().int().positive(),
    transferredOn: dayField,
    squadNumber: squadNumberField,
  })
  .strict();

export const clubIdParams = z.object({ clubId: z.coerce.number().int().positive() }).strict();
export const playerIdParams = z.object({ playerId: z.coerce.number().int().positive() }).strict();

export const listPlayersQuery = z
  .object({
    clubId: z.coerce.number().int().positive().optional(),
    position: z.enum(POSITIONS).optional(),
    status: z.enum(PLAYER_STATUSES).optional(),
  })
  .strict();

export const noQuery = z.object({}).strict();

export type RegisterPlayerBody = z.infer<typeof registerPlayerBody>;
export type UpdatePlayerBody = z.infer<typeof updatePlayerBody>;
export type ReleasePlayerBody = z.infer<typeof releasePlayerBody>;
export type TransferPlayerBody = z.infer<typeof transferPlayerBody>;
export type ListPlayersQuery = z.infer<typeof listPlayersQuery>;
