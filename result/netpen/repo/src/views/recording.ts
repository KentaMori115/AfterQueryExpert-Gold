/**
 * The two things every recording form does.
 *
 * There are three of them now, all with the same shape: refuse to be closed on
 * top of work that has not been filed, and swallow a refused write because the
 * mutation already carries it onto the screen. Both were written out three
 * times, and the copies had already gone their own ways: one asked before
 * discarding an empty form, and one let the rejection out of the click handler
 * as an unhandled promise.
 *
 * Small enough to look like over-abstraction, and it is not: the cost of these
 * going wrong is a lice count that somebody typed and the register never got.
 */

export type Guard = () => boolean;

/**
 * A close guard. Returns true to let the dialog close.
 *
 * Nothing entered means nothing to lose, so it does not ask; asking on an
 * untouched form trains people to click through the question, which is exactly
 * the habit that loses the count on the day it matters.
 */
export function discardGuard(
  hasEntry: () => boolean,
  question: string,
  confirm: (message: string) => boolean = (message) => globalThis.confirm(message),
): Guard {
  return () => (hasEntry() ? confirm(question) : true);
}

export interface SubmitResult {
  readonly filed: boolean;
}

/**
 * Runs the write and reports whether it landed.
 *
 * The rejection is caught rather than rethrown. Every one of these forms shows
 * the failure through the mutation's own error state, and letting it out of a
 * click handler on top of that gets an unhandled rejection and a console
 * nobody on a barge is going to read.
 */
export async function fileQuietly(write: () => Promise<unknown>): Promise<SubmitResult> {
  try {
    await write();
    return { filed: true };
  } catch {
    return { filed: false };
  }
}
