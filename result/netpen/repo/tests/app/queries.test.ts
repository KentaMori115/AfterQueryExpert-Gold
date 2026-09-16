import { describe, expect, it } from 'vitest';

import {
  createQueryClient,
  GC_AFTER_MS,
  isWorthRetrying,
  MAX_RETRIES,
  retryDelayMs,
  STALE_AFTER_MS,
} from '@/app/queries';
import { NotFoundError, QUERY_KEYS, RefusedError } from '@/data/api';
import { ApiError } from '@/data/http';

describe('what is worth retrying', () => {
  it('retries a dropped link', () => {
    expect(isWorthRetrying(new ApiError('offline', 'no link'))).toBe(true);
    expect(isWorthRetrying(new ApiError('timeout', 'slow'))).toBe(true);
    expect(isWorthRetrying(new ApiError('server', 'broken'))).toBe(true);
  });

  it('does not retry a refusal', () => {
    expect(isWorthRetrying(new RefusedError('no', 'role-not-permitted'))).toBe(false);
    expect(isWorthRetrying(new NotFoundError('pen', 'pen-99'))).toBe(false);
    expect(isWorthRetrying(new ApiError('forbidden', 'no'))).toBe(false);
    expect(isWorthRetrying(new ApiError('conflict', 'no'))).toBe(false);
  });

  it('does not retry a payload this version cannot read', () => {
    expect(isWorthRetrying(new ApiError('malformed-response', 'no'))).toBe(false);
  });

  it('retries anything it does not recognise, rather than giving up', () => {
    expect(isWorthRetrying(new Error('who knows'))).toBe(true);
    expect(isWorthRetrying('a string')).toBe(true);
  });
});

describe('the retry delay', () => {
  it('backs off geometrically', () => {
    expect(retryDelayMs(0)).toBe(600);
    expect(retryDelayMs(1)).toBe(1_200);
    expect(retryDelayMs(2)).toBe(2_400);
  });

  it('caps so the terminal never looks frozen', () => {
    expect(retryDelayMs(10)).toBe(6_000);
  });

  it('gives up after a handful of attempts', () => {
    expect(MAX_RETRIES).toBeLessThanOrEqual(4);
  });
});

describe('the client defaults', () => {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();

  it('holds a read for a sensible window', () => {
    expect(defaults.queries?.staleTime).toBe(STALE_AFTER_MS);
    expect(defaults.queries?.gcTime).toBe(GC_AFTER_MS);
  });

  it('refetches when the terminal comes back', () => {
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
  });

  it('never retries a write, which would file it twice', () => {
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('stops retrying a read at the limit', () => {
    const retry = defaults.queries?.retry as (count: number, error: unknown) => boolean;
    const offline = new ApiError('offline', 'no link');
    expect(retry(0, offline)).toBe(true);
    expect(retry(MAX_RETRIES, offline)).toBe(false);
  });
});

describe('the query keys', () => {
  it('separates each collection', () => {
    expect(QUERY_KEYS.site[0]).toBe('site');
    expect(QUERY_KEYS.pens[0]).toBe('pens');
  });

  it('buckets the time dependent ones so a tick invalidates together', () => {
    expect(QUERY_KEYS.penBoard(41)).toEqual(['pen-board', 41]);
    expect(QUERY_KEYS.penBoard(41)).not.toEqual(QUERY_KEYS.penBoard(42));
    expect(QUERY_KEYS.siteView(41)[0]).toBe('site-view');
  });

  it('keys a pen by its id and the bucket together', () => {
    expect(QUERY_KEYS.pen('pen-3', 41)).toEqual(['pen', 'pen-3', 41]);
    expect(QUERY_KEYS.pen('pen-3', 41)).not.toEqual(QUERY_KEYS.pen('pen-4', 41));
  });

  it('gives the unfiltered list a key of its own', () => {
    expect(QUERY_KEYS.liceCounts(null)).toEqual(['lice-counts', 'all']);
    expect(QUERY_KEYS.treatments('pen-3')).toEqual(['treatments', 'pen-3']);
  });

  it('keys an oxygen window by both ends', () => {
    expect(QUERY_KEYS.oxygen('pen-3', 100, 200)).toEqual(['oxygen', 'pen-3', 100, 200]);
  });
});
