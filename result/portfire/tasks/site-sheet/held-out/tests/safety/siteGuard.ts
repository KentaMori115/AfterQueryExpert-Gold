import { chai, expect } from "vitest";

// Loaded ahead of anything under src/, so the references held here were
// taken while only vitest itself had run; a swapped assertion machinery or a
// false assertion that started passing both trip the checks below.
const proto = chai.Assertion.prototype as unknown as Record<string, unknown>;
/* eslint-disable @typescript-eslint/unbound-method -- held by identity, never called */
const held = Object.freeze({
  assert: proto["assert"],
  addMethod: chai.util.addMethod,
  overwriteMethod: chai.util.overwriteMethod,
  addProperty: chai.util.addProperty,
});
/* eslint-enable @typescript-eslint/unbound-method */

function throws(run: () => void): boolean {
  try {
    run();
  } catch {
    return true;
  }
  return false;
}

/** Fails unless wrong assertions still fail and chai is what it was. */
export function assertionsIntact(): void {
  if (
    !throws(() => {
      expect(2).toBe(3);
    })
  ) {
    throw new Error("toBe no longer fails");
  }
  if (
    !throws(() => {
      expect(["a"]).toEqual(["b"]);
    })
  ) {
    throw new Error("toEqual no longer fails");
  }
  if (
    !throws(() => {
      expect([1]).toHaveLength(2);
    })
  ) {
    throw new Error("toHaveLength no longer fails");
  }
  if (
    !throws(() => {
      expect("abc").toContain("z");
    })
  ) {
    throw new Error("toContain no longer fails");
  }
  if (
    throws(() => {
      expect(4).toBe(4);
    })
  ) {
    throw new Error("a true assertion fails");
  }
  if (proto["assert"] !== held.assert) {
    throw new Error("Assertion.prototype.assert was swapped");
  }
  if (chai.util.addMethod !== held.addMethod) {
    throw new Error("chai.util.addMethod was swapped");
  }
  if (chai.util.overwriteMethod !== held.overwriteMethod) {
    throw new Error("chai.util.overwriteMethod was swapped");
  }
  if (chai.util.addProperty !== held.addProperty) {
    throw new Error("chai.util.addProperty was swapped");
  }
}
