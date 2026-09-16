/**
 * Helpers for exercising the HTTP boundary.
 *
 * captureApiError exists because awaiting a rejection and casting gives a
 * union of the success type and the error, which then needs a cast at every
 * property access. Narrowing once here keeps the casts out of the tests.
 */

import { expect, vi } from 'vitest';

import { ApiError, createHttpClient, type HttpClient } from '@/data/http';

export const TEST_BASE_URL = 'https://netpen.test/api/';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface Stub {
  readonly client: HttpClient;
  readonly fetchMock: ReturnType<typeof vi.fn>;
  initFor(call?: number): RequestInit;
  urlFor(call?: number): string;
}

export interface StubOptions {
  readonly isOnline?: () => boolean;
  readonly defaultTimeoutMs?: number;
}

function wrap(fetchMock: ReturnType<typeof vi.fn>, options: StubOptions = {}): Stub {
  return {
    client: createHttpClient({
      baseUrl: TEST_BASE_URL,
      fetchImpl: fetchMock as unknown as typeof fetch,
      isOnline: options.isOnline,
      defaultTimeoutMs: options.defaultTimeoutMs,
    }),
    fetchMock,
    initFor(call = 0) {
      return (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;
    },
    urlFor(call = 0) {
      const input = fetchMock.mock.calls[call]?.[0];
      return typeof input === 'string' ? input : input instanceof URL ? input.href : '';
    },
  };
}

export function stubClient(
  response: Response | (() => Promise<Response>),
  options: StubOptions = {},
): Stub {
  return wrap(
    vi.fn(typeof response === 'function' ? response : () => Promise.resolve(response)),
    options,
  );
}

export function failingClient(reason: unknown, options: StubOptions = {}): Stub {
  // The reason is deliberately unknown: several of these tests are about what
  // happens when fetch rejects with something that is not an Error at all.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return wrap(
    vi.fn(() => Promise.reject(reason)),
    options,
  );
}

/** Await a request that must reject with an ApiError, narrowed to that type. */
export async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(ApiError);
    return caught as ApiError;
  }
  throw new Error('Expected the request to reject with an ApiError, it resolved instead');
}
