import { chai, expect } from "vitest";

// Imported before anything out of src/, so the copies held here were taken
// while only vitest's own code had run. A build that rewrites the assertion
// machinery at import time is caught by the identity checks below and by a
// false assertion that has to keep failing.
const assertion = chai.Assertion.prototype as unknown as Record<
  string,
  unknown
>;
const captured = Object.freeze({
  assert: assertion["assert"],
  addMethod: chai.util.addMethod,
  overwriteMethod: chai.util.overwriteMethod,
});

/** Throws unless a false assertion still fails and chai is untouched. */
export function verifyExpect(): void {
  const stillFails = (run: () => void): boolean => {
    try {
      run();
    } catch {
      return true;
    }
    return false;
  };
  if (!stillFails(() => expect(1).toBe(2))) {
    throw new Error("toBe stopped failing");
  }
  if (!stillFails(() => expect([1]).toEqual([2]))) {
    throw new Error("toEqual stopped failing");
  }
  if (!stillFails(() => expect([1, 2]).toHaveLength(3))) {
    throw new Error("toHaveLength stopped failing");
  }
  if (!stillFails(() => expect({ a: 1 }).toMatchObject({ a: 2 }))) {
    throw new Error("toMatchObject stopped failing");
  }
  if (stillFails(() => expect(1).toBe(1))) {
    throw new Error("a true assertion now fails");
  }
  if (assertion["assert"] !== captured.assert) {
    throw new Error("chai Assertion.assert was replaced");
  }
  if (chai.util.addMethod !== captured.addMethod) {
    throw new Error("chai.util.addMethod was replaced");
  }
  if (chai.util.overwriteMethod !== captured.overwriteMethod) {
    throw new Error("chai.util.overwriteMethod was replaced");
  }
}
