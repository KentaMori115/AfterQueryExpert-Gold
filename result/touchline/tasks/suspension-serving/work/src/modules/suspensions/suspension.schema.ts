/** What a caller may send to the suspension routes. */
import { z } from 'zod';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');

export const playerIdParams = z.object({ playerId: z.coerce.number().int().positive() }).strict();
export const fixtureIdParams = z.object({ fixtureId: z.coerce.number().int().positive() }).strict();

/** A ledger always takes an asOf, like the table and the record. */
export const ledgerQuery = z.object({ asOf: dayField }).strict();

/** Eligibility names its own day, the one before the game, so the query takes nothing. */
export const noQuery = z.object({}).strict();

export type LedgerQuery = z.infer<typeof ledgerQuery>;
