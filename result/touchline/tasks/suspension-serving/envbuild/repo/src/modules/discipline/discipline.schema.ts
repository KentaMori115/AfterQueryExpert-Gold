/** What a caller may send to the discipline routes. */
import { z } from 'zod';
import { DISCIPLINE_STATUSES, OFFENCES } from './discipline.types';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');

export const showCardBody = z
  .object({
    playerId: z.number().int().positive(),
    offence: z.enum(OFFENCES),
    shownOn: dayField,
  })
  .strict();

export const rescindCardBody = z
  .object({
    rescindedOn: dayField,
  })
  .strict();

export const fixtureIdParams = z.object({ fixtureId: z.coerce.number().int().positive() }).strict();
export const cardIdParams = z.object({ cardId: z.coerce.number().int().positive() }).strict();
export const playerIdParams = z.object({ playerId: z.coerce.number().int().positive() }).strict();

export const listCardsQuery = z
  .object({
    playerId: z.coerce.number().int().positive().optional(),
    teamId: z.coerce.number().int().positive().optional(),
    fixtureId: z.coerce.number().int().positive().optional(),
    colour: z.enum(['yellow', 'red']).optional(),
    status: z.enum(DISCIPLINE_STATUSES).optional(),
  })
  .strict();

/** The record reading takes an asOf, like every other reading in the league. */
export const recordQuery = z.object({ asOf: dayField }).strict();

export const noQuery = z.object({}).strict();

export type ShowCardBody = z.infer<typeof showCardBody>;
export type RescindCardBody = z.infer<typeof rescindCardBody>;
export type ListCardsQuery = z.infer<typeof listCardsQuery>;
export type RecordQuery = z.infer<typeof recordQuery>;
