import { chai, expect } from "vitest";

/**
 * Assertions taken before anything under src/ can run.
 *
 * Every case in the suites that import this file reaches the code under
 * test through the ordinary `expect`, and that `expect` is chai underneath.
 * A module under src/ evaluates before the first case and could reach the
 * same chai, so this file, imported ahead of src/ in each suite, keeps a
 * record of what the assertion prototype looked like at that moment and can
 * say later whether anything on it was swapped. A handful of cases ask.
 */

const prototype: object = chai.Assertion.prototype;

const recorded = new Map<string | symbol, PropertyDescriptor>();
for (const key of Reflect.ownKeys(prototype)) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
  if (descriptor !== undefined) {
    recorded.set(key, descriptor);
  }
}

function same(a: PropertyDescriptor, b: PropertyDescriptor): boolean {
  return a.value === b.value && a.get === b.get && a.set === b.set;
}

/** Throws when a false assertion no longer fails or a matcher was replaced. */
export function verifyAssertions(): void {
  let refused = false;
  try {
    expect(1).toBe(2);
  } catch {
    refused = true;
  }
  if (!refused) {
    throw new Error("a false toBe no longer fails");
  }
  refused = false;
  try {
    expect({ pin: 1 }).toEqual({ pin: 2 });
  } catch {
    refused = true;
  }
  if (!refused) {
    throw new Error("a false toEqual no longer fails");
  }
  refused = false;
  try {
    expect([1, 2]).toHaveLength(3);
  } catch {
    refused = true;
  }
  if (!refused) {
    throw new Error("a false toHaveLength no longer fails");
  }
  try {
    expect(1).toBe(1);
    expect({ pin: 1 }).toEqual({ pin: 1 });
  } catch {
    throw new Error("a true assertion fails");
  }
  for (const [key, descriptor] of recorded) {
    const live = Object.getOwnPropertyDescriptor(prototype, key);
    if (live === undefined || !same(live, descriptor)) {
      throw new Error(
        `assertion ${String(key)} was replaced after the suite loaded`,
      );
    }
  }
  for (const key of Reflect.ownKeys(prototype)) {
    if (!recorded.has(key)) {
      throw new Error(
        `assertion ${String(key)} appeared after the suite loaded`,
      );
    }
  }
}

/** How many matchers the record holds, so a case can see it is not empty. */
export function recordedMatchers(): number {
  return recorded.size;
}
