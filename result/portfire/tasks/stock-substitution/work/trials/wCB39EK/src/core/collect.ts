/**
 * Counting and grouping.
 *
 * Nine places in portfire were building a tally with `map.set(key, (map.get(
 * key) ?? 0) + 1)`, and three of them had quietly picked different orders to
 * hand the result back in. The counting was never the interesting part of any
 * of them, so it lives here and the ordering decision gets made once.
 */

export function countBy<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function sumBy<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
  valueOf: (item: T) => number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    totals.set(key, (totals.get(key) ?? 0) + valueOf(item));
  }
  return totals;
}

export function groupBy<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const held = groups.get(key);
    if (held === undefined) {
      groups.set(key, [item]);
    } else {
      held.push(item);
    }
  }
  return groups;
}

/**
 * Entries in key order. A Map iterates in insertion order, which for a tally
 * means whatever order the show happened to be written in, and that is never
 * what a report wants.
 */
export function sortedEntries<V>(
  map: ReadonlyMap<string, V>,
  compare: (a: string, b: string) => number = (a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
): [string, V][] {
  return [...map.entries()].sort((a, b) => compare(a[0], b[0]));
}

/** Entries with the largest value first, ties broken by key. */
export function rankedEntries(
  map: ReadonlyMap<string, number>,
): [string, number][] {
  return [...map.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
}

/** The distinct values a key takes, in sorted order. */
export function distinct<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string,
): string[] {
  return [...new Set([...items].map(keyOf))].sort();
}
