import { chai, expect } from "vitest";

// Imported before anything out of src/, so the copies held here were taken
// while only vitest's own code had run. A build that rewrites the assertion
// machinery at import time is caught by the identity checks below and by a
// false assertion that has to keep failing.
const assertion = chai.Assertion.prototype as unknown as Record<
  string,
  unknown
>;
/* eslint-disable @typescript-eslint/unbound-method */
const captured = Object.freeze({
  assert: assertion["assert"],
  addMethod: chai.util.addMethod,
  overwriteMethod: chai.util.overwriteMethod,
});
/* eslint-enable @typescript-eslint/unbound-method */

/* eslint-disable @typescript-eslint/no-confusing-void-expression */
const MUST_FAIL: readonly (readonly [string, () => void])[] = [
  ["toBe", () => expect(1).toBe(2)],
  ["toEqual", () => expect([1]).toEqual([2])],
];
/* eslint-enable @typescript-eslint/no-confusing-void-expression */

function fails(run: () => void): boolean {
  try {
    run();
  } catch {
    return true;
  }
  return false;
}

/** Throws unless a false assertion still fails and chai is untouched. */
export function verifyExpect(): void {
  for (const [name, run] of MUST_FAIL) {
    if (!fails(run)) {
      throw new Error(`${name} stopped failing`);
    }
  }
  if (
    fails(() => {
      expect(1).toBe(1);
    })
  ) {
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
