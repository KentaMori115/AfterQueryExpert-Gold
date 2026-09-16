// A dependency-free stand-in for the slice of vitest this repository's suites
// use. Loaded before anything under /app, so the comparisons below cannot be
// swapped out by the code under test.
const $is = Object.is
const $abs = Math.abs
const $pow = Math.pow
const $keys = Object.keys
const $isArray = Array.isArray
const $stringify = JSON.stringify
const $push = Array.prototype.push

const stack = []
export const suites = []

export function reset() {
  suites.length = 0
  stack.length = 0
}

export function describe(name, fn) {
  const node = { name: String(name), tests: [], parent: stack[stack.length - 1] ?? null }
  $push.call(suites, node)
  $push.call(stack, node)
  try {
    fn()
  } finally {
    stack.pop()
  }
}
describe.each = undefined

export function it(name, fn) {
  const parent = stack[stack.length - 1] ?? null
  const entry = { name: String(name), fn, suite: parent }
  if (parent) {
    $push.call(parent.tests, entry)
  } else {
    $push.call(suites, { name: '', tests: [entry], parent: null })
  }
}
export const test = it

export function titleOf(suite, entry) {
  const parts = []
  let cursor = suite
  while (cursor) {
    if (cursor.name) parts.unshift(cursor.name)
    cursor = cursor.parent
  }
  parts.push(entry.name)
  return parts.join(' > ')
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function deepEqual(a, b) {
  if ($is(a, b)) return true
  if (typeof a === 'number' && typeof b === 'number' && a === b) return true
  if (!isObject(a) || !isObject(b)) return false
  if ($isArray(a) !== $isArray(b)) return false
  const left = $keys(a).filter((key) => a[key] !== undefined)
  const right = $keys(b).filter((key) => b[key] !== undefined)
  if (left.length !== right.length) return false
  for (const key of left) {
    if (!right.includes(key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function subsetOf(actual, expected) {
  if (!isObject(expected)) return deepEqual(actual, expected)
  if (!isObject(actual)) return false
  for (const key of $keys(expected)) {
    const want = expected[key]
    if (isObject(want)) {
      if (!subsetOf(actual[key], want)) return false
    } else if (!$is(actual[key], want)) {
      return false
    }
  }
  return true
}

function show(value) {
  try {
    const text = $stringify(value)
    return text === undefined ? String(value) : text
  } catch (error) {
    return String(value)
  }
}

function fail(message) {
  const error = new Error(message)
  error.name = 'AssertionError'
  throw error
}

function build(actual, negated) {
  const check = (condition, message) => {
    if (negated ? condition : !condition) fail(message)
  }
  return {
    get not() {
      return build(actual, !negated)
    },
    toBe(expected) {
      check($is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`)
    },
    toEqual(expected) {
      check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`)
    },
    toStrictEqual(expected) {
      check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`)
    },
    toMatchObject(expected) {
      check(subsetOf(actual, expected), `expected ${show(actual)} to match ${show(expected)}`)
    },
    toHaveLength(size) {
      check(actual != null && actual.length === size, `expected length ${actual == null ? 'none' : actual.length} to be ${size}`)
    },
    toHaveProperty(key) {
      check(isObject(actual) && key in actual, `expected ${show(actual)} to have ${key}`)
    },
    toBeNull() {
      check(actual === null, `expected ${show(actual)} to be null`)
    },
    toBeUndefined() {
      check(actual === undefined, `expected ${show(actual)} to be undefined`)
    },
    toBeDefined() {
      check(actual !== undefined, 'expected a defined value')
    },
    toBeTruthy() {
      check(Boolean(actual), `expected ${show(actual)} to be truthy`)
    },
    toBeFalsy() {
      check(!actual, `expected ${show(actual)} to be falsy`)
    },
    toBeGreaterThan(limit) {
      check(actual > limit, `expected ${show(actual)} above ${show(limit)}`)
    },
    toBeGreaterThanOrEqual(limit) {
      check(actual >= limit, `expected ${show(actual)} at or above ${show(limit)}`)
    },
    toBeLessThan(limit) {
      check(actual < limit, `expected ${show(actual)} below ${show(limit)}`)
    },
    toBeLessThanOrEqual(limit) {
      check(actual <= limit, `expected ${show(actual)} at or below ${show(limit)}`)
    },
    toBeCloseTo(expected, precision = 2) {
      check($abs(actual - expected) < $pow(10, -precision) / 2, `expected ${show(actual)} close to ${show(expected)}`)
    },
    toContain(item) {
      const found =
        typeof actual === 'string'
          ? actual.includes(item)
          : $isArray(actual) && actual.includes(item)
      check(found, `expected ${show(actual)} to contain ${show(item)}`)
    },
    toThrow(matcher) {
      let threw = false
      let thrown = null
      try {
        actual()
      } catch (error) {
        threw = true
        thrown = error
      }
      if (negated) {
        if (threw) fail(`expected no throw, got ${thrown && thrown.message}`)
        return
      }
      if (!threw) fail('expected a throw')
      if (matcher === undefined) return
      const message = thrown && thrown.message ? String(thrown.message) : String(thrown)
      if (matcher instanceof RegExp) {
        if (!matcher.test(message)) fail(`message ${show(message)} does not match ${matcher}`)
        return
      }
      if (typeof matcher === 'string') {
        if (!message.includes(matcher)) fail(`message ${show(message)} lacks ${show(matcher)}`)
        return
      }
      if (typeof matcher === 'function') {
        if (!(thrown instanceof matcher)) fail(`thrown value is not ${matcher.name}`)
      }
    },
  }
}

export function expect(actual) {
  return build(actual, false)
}
expect.any = undefined

export default { describe, it, test, expect }
