/**
 * A result that carries its failures instead of throwing them.
 *
 * Nothing in portfire stops at the first bad cue. A shooter who runs a check
 * wants every problem in the script, not the earliest one, because each round
 * trip through the script means another hour on a field with a laptop. So the
 * loading, resolving and validating layers all return a `Result` and the
 * failures accumulate.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly errors: readonly E[];
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(...errors: readonly E[]): Err<E> {
  if (errors.length === 0) {
    throw new RangeError("an Err needs at least one error");
  }
  return { ok: false, errors };
}

export function errAll<E>(errors: readonly E[]): Err<E> {
  return err(...errors);
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : errAll(result.errors.map(fn));
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Take the value or throw. Only the CLI and tests should reach for this, since
 * everything inside the library is supposed to report rather than abort.
 */
export function expect<T, E>(result: Result<T, E>, what: string): T {
  if (result.ok) {
    return result.value;
  }
  const detail = result.errors.map((error) => describe(error)).join("; ");
  throw new Error(`${what}: ${detail}`);
}

function describe(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message: unknown = (error as { message: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return JSON.stringify(error);
}

/**
 * Turn a list of results into a result of a list, keeping every error rather
 * than the first. This is the whole point of the type, so it gets the short
 * name.
 */
export function collect<T, E>(
  results: readonly Result<T, E>[],
): Result<T[], E> {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  }
  return errors.length > 0 ? errAll(errors) : ok(values);
}

/** Map every item, then collect. The common shape of a loading pass. */
export function traverse<T, U, E>(
  items: readonly T[],
  fn: (item: T, index: number) => Result<U, E>,
): Result<U[], E> {
  return collect(items.map((item, index) => fn(item, index)));
}

/**
 * Split results into what succeeded and what did not. Used where a partial
 * answer is still worth having, such as listing the cues that resolved so the
 * shooter can see how far the script got.
 */
export function partition<T, E>(
  results: readonly Result<T, E>[],
): { readonly values: T[]; readonly errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  }
  return { values, errors };
}

/** Combine two results, keeping both sets of errors when both failed. */
export function both<A, B, E>(
  left: Result<A, E>,
  right: Result<B, E>,
): Result<[A, B], E> {
  if (left.ok && right.ok) {
    return ok([left.value, right.value]);
  }
  const errors: E[] = [];
  if (!left.ok) {
    errors.push(...left.errors);
  }
  if (!right.ok) {
    errors.push(...right.errors);
  }
  return errAll(errors);
}

/** Run a function that may throw and turn the throw into an Err. */
export function attempt<T>(fn: () => T): Result<T, string> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(describe(thrown));
  }
}
