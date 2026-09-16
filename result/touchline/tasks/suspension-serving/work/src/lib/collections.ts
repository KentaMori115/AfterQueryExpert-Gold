/**
 * Small helpers for reading arrays under `noUncheckedIndexedAccess`, which is
 * on because it catches real mistakes but makes `list[0]` a maybe-undefined.
 */

/** The item at `index`, or undefined. Just `list[index]` with the intent written down. */
export function at<T>(list: readonly T[], index: number): T | undefined {
  return list[index];
}

/** The item at `index`, refusing to continue when it is not there. */
export function must<T>(list: readonly T[], index: number, label = 'item'): T {
  const found = list[index];
  if (found === undefined) {
    throw new Error(`expected a ${label} at index ${index} of ${list.length}`);
  }
  return found;
}

export function first<T>(list: readonly T[]): T | undefined {
  return list[0];
}

export function last<T>(list: readonly T[]): T | undefined {
  return list[list.length - 1];
}

/** Groups by a derived key, keeping the order each group was first seen in. */
export function groupBy<T, K extends string | number>(
  list: readonly T[],
  key: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of list) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket === undefined) out.set(k, [item]);
    else bucket.push(item);
  }
  return out;
}

/** Sums a derived number over a list. */
export function sumBy<T>(list: readonly T[], value: (item: T) => number): number {
  let total = 0;
  for (const item of list) total += value(item);
  return total;
}

/** Counts the items a test holds for. */
export function countWhere<T>(list: readonly T[], test: (item: T) => boolean): number {
  let total = 0;
  for (const item of list) if (test(item)) total += 1;
  return total;
}
