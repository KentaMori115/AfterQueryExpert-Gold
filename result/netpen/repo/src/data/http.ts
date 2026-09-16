/**
 * The HTTP boundary.
 *
 * Everything the interface fetches comes back parsed against a schema or is
 * thrown as a typed error. Nothing above this sees a Response, a raw payload,
 * or an unvalidated shape.
 *
 * The error taxonomy is small because the interface has only a handful of
 * genuinely different things to say, and one of them matters far more here
 * than in an office application: the link is down. A site runs on a radio link
 * to shore that drops when it rains hard, and telling somebody "the server had
 * a problem" when the truth is "you are offline, this will send when you are
 * back" is the difference between a useful screen and a distrusted one.
 */

import type { ZodType, ZodTypeDef } from 'zod';

export type ApiErrorKind =
  | 'offline'
  | 'timeout'
  | 'unauthorised'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'server'
  | 'malformed-response';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    detail: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }

  /** Worth trying again on its own; a refusal is not. */
  get isRetryable(): boolean {
    return this.kind === 'offline' || this.kind === 'timeout' || this.kind === 'server';
  }

  /** Safe to hold and send later, which is what the write queue asks. */
  get isQueueable(): boolean {
    return this.kind === 'offline' || this.kind === 'timeout';
  }
}

const MESSAGES: Record<ApiErrorKind, string> = {
  offline: 'No link to shore, this will send when the connection is back',
  timeout: 'The server did not answer in time',
  unauthorised: 'Your session has expired',
  forbidden: 'You do not have access to this',
  'not-found': 'That record no longer exists',
  conflict: 'Someone else changed this first',
  validation: 'The server rejected the values submitted',
  server: 'The server ran into a problem',
  'malformed-response': 'The server sent something this version cannot read',
};

export function messageFor(kind: ApiErrorKind): string {
  return MESSAGES[kind];
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorised';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  if (status === 408 || status === 504) return 'timeout';
  return 'server';
}

export interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /**
   * Input is unknown rather than T because these schemas transform on the way
   * through: an ISO string on the wire becomes epoch milliseconds inside.
   */
  readonly schema: ZodType<T, ZodTypeDef, unknown>;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Milliseconds before the request is abandoned. */
  readonly timeoutMs?: number;
}

export interface HttpClient {
  request<T>(path: string, options: RequestOptions<T>): Promise<T>;
}

export interface HttpClientConfig {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  /** Injected so a test can say the link is down without touching navigator. */
  readonly isOnline?: () => boolean;
  readonly defaultTimeoutMs?: number;
}

async function readDetail(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message;
      return typeof message === 'string' ? message : null;
    }
    return text.slice(0, 400);
  } catch {
    return null;
  }
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/$/, '');
  const online = config.isOnline ?? (() => true);

  return {
    async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
      if (!online()) {
        throw new ApiError('offline', MESSAGES.offline);
      }

      const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      options.signal?.addEventListener('abort', () => {
        controller.abort();
      });

      let response: Response;
      try {
        response = await doFetch(url, {
          method: options.method ?? 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...config.defaultHeaders,
            ...options.headers,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (cause) {
        if (options.signal?.aborted) throw cause;
        const aborted = cause instanceof DOMException && cause.name === 'AbortError';
        const kind: ApiErrorKind = aborted ? 'timeout' : online() ? 'server' : 'offline';
        throw new ApiError(kind, MESSAGES[kind], null, String(cause));
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const kind = kindForStatus(response.status);
        throw new ApiError(kind, MESSAGES[kind], response.status, await readDetail(response));
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError('malformed-response', MESSAGES['malformed-response'], response.status);
      }

      const parsed = options.schema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = first ? first.path.join('.') || '(root)' : 'unknown field';
        throw new ApiError(
          'malformed-response',
          MESSAGES['malformed-response'],
          response.status,
          `${where}: ${first?.message ?? 'failed validation'}`,
        );
      }

      return parsed.data;
    },
  };
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Message fit to put in front of a crew member. */
export function describeError(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
