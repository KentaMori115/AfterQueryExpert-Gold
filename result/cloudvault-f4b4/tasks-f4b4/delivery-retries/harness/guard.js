// Runs inside every test worker, after the framework is installed and before
// the test file (and therefore before any repository module) is loaded.
//
// A submitted module is imported by the graded suite and runs in this same
// worker, so it can reach the globals the suite asserts through. Snapshot the
// decision points here, then prove before and after each case that they still
// behave: an assertion that cannot fail is worth nothing.
const snapshot = {
    expect: global.expect,
    is: Object.is,
    stringify: JSON.stringify,
    getPrototypeOf: Object.getPrototypeOf,
}

function control() {
    if (global.expect !== snapshot.expect) {
        throw new Error("verifier: the expect global was replaced")
    }
    if (Object.is !== snapshot.is || JSON.stringify !== snapshot.stringify) {
        throw new Error("verifier: a comparison primitive was replaced")
    }
    if (Object.getPrototypeOf !== snapshot.getPrototypeOf) {
        throw new Error("verifier: Object.getPrototypeOf was replaced")
    }

    let threw = false
    try {
        snapshot.expect(1).toBe(2)
    } catch (err) {
        threw = true
    }
    if (!threw) {
        throw new Error("verifier: a failing assertion did not fail")
    }

    let objectThrew = false
    try {
        snapshot.expect({ a: 1 }).toEqual({ a: 2 })
    } catch (err) {
        objectThrew = true
    }
    if (!objectThrew) {
        throw new Error("verifier: a failing structural assertion did not fail")
    }
}

beforeEach(control)
afterEach(control)
