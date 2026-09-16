// A stand-in for the slice of the vitest API this repository's cases use, so a
// verifier can run them with nothing but node. Cases are collected while a file
// is imported and run afterwards, one at a time.
const suites = [];
const stack = [];
const cases = [];

export function describe(title, body) {
  stack.push(String(title));
  try {
    body();
  } finally {
    stack.pop();
  }
}

function record(title, body) {
  cases.push({ path: [...stack], title: String(title), body });
}

function each(rows) {
  return (title, body) =>
    rows.forEach((row) => {
      const args = Array.isArray(row) ? row : [row];
      let index = 0;
      const named = String(title).replace(/%[sdifjo%]/g, (token) => {
        if (token === "%%") {
          return "%";
        }
        const value = args[index++];
        if (typeof value === "bigint") {
          return `${value}n`;
        }
        if (typeof value === "object" && value !== null) {
          return JSON.stringify(value);
        }
        return String(value);
      });
      record(named, () => body(...args));
    });
}

export function it(title, body) {
  record(title, body);
}
it.each = each;

export const test = it;
test.each = each;

function label(value) {
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? `${item}n` : item,
    );
  } catch {
    return String(value);
  }
}

function same(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left === null || right === null || typeof left !== "object") {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((item, at) => same(item, right[at]));
  }
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => key in right && same(left[key], right[key]));
}

function fail(message) {
  throw new Error(message);
}

function matchers(actual, negated) {
  const check = (ok, message) => {
    if (ok === negated) {
      fail(message);
    }
  };
  return {
    toBe(expected) {
      check(Object.is(actual, expected), `expected ${label(actual)} to be ${label(expected)}`);
    },
    toEqual(expected) {
      check(same(actual, expected), `expected ${label(actual)} to equal ${label(expected)}`);
    },
    toHaveLength(expected) {
      check(
        actual !== null && actual !== undefined && actual.length === expected,
        `expected length ${label(actual?.length)} to be ${label(expected)}`,
      );
    },
    toContain(expected) {
      check(
        typeof actual === "string" || Array.isArray(actual)
          ? actual.includes(expected)
          : false,
        `expected ${label(actual)} to contain ${label(expected)}`,
      );
    },
    toMatch(expected) {
      const pattern = expected instanceof RegExp ? expected : new RegExp(expected);
      check(pattern.test(String(actual)), `expected ${label(actual)} to match ${expected}`);
    },
    toBeDefined() {
      check(actual !== undefined, `expected ${label(actual)} to be defined`);
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${label(actual)} to be undefined`);
    },
    toBeGreaterThan(expected) {
      check(actual > expected, `expected ${label(actual)} to be greater than ${label(expected)}`);
    },
    toBeGreaterThanOrEqual(expected) {
      check(actual >= expected, `expected ${label(actual)} to be at least ${label(expected)}`);
    },
    toBeLessThan(expected) {
      check(actual < expected, `expected ${label(actual)} to be less than ${label(expected)}`);
    },
    toBeLessThanOrEqual(expected) {
      check(actual <= expected, `expected ${label(actual)} to be at most ${label(expected)}`);
    },
    toThrow(expected) {
      let threw = false;
      let thrown;
      let message = "";
      try {
        actual();
      } catch (error) {
        threw = true;
        thrown = error;
        message = error instanceof Error ? error.message : String(error);
      }
      if (expected === undefined) {
        check(threw, "expected the call to throw");
        return;
      }
      if (typeof expected === "function") {
        check(threw && thrown instanceof expected, `expected a throw of ${expected.name}`);
        return;
      }
      const pattern = expected instanceof RegExp ? expected : new RegExp(String(expected));
      check(threw && pattern.test(message), `expected a throw matching ${expected}`);
    },
  };
}

export function expect(actual) {
  const built = matchers(actual, false);
  built.not = matchers(actual, true);
  return built;
}

export function drain() {
  const taken = cases.splice(0, cases.length);
  suites.push(...taken);
  return taken;
}
