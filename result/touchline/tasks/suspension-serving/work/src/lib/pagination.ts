/**
 * Clamps a caller's paging to something the database can answer quickly.
 *
 * The maximum is part of the contract, not an implementation detail, so it is
 * enforced by the schema too rather than silently truncating a larger ask.
 */
export interface Page {
  limit: number;
  offset: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function pageFrom(limit?: number, offset?: number): Page {
  return {
    limit: Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT),
    offset: offset ?? 0,
  };
}
