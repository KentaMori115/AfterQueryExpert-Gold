/** What a caller may send to the table route. */
import { z } from 'zod';

export const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must read YYYY-MM-DD');

export const divisionIdParams = z
  .object({ divisionId: z.coerce.number().int().positive() })
  .strict();

/** The table always takes an asOf. Reading the clock would make it unreproducible. */
export const tableQuery = z.object({ asOf: dayField }).strict();

export type TableQuery = z.infer<typeof tableQuery>;
