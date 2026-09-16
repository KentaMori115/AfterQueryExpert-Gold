// A dependency-free stand-in for the slice of vitest this repository's suites
// use.
//
// This module is evaluated before a line of repository code exists in the
// process, and everything it will ever need is taken here, at the top: the
// builtins it calls, the array methods it calls them through, and Reflect's
// own apply. After that the shim never dispatches a method off a prototype
// chain, so a submission that rewrites Array.prototype or Object.prototype
// later changes nothing about how a case is collected, run or judged.
//
// It also hands nothing out. No mutable collection is exported; the control
// surface the runner needs is handed to the first caller and then withdrawn,
// so a module that finds this file on disk and imports it a second time gets
// null instead of the case list.
const $apply = Reflect.apply
const $defineProperty = Object.defineProperty
const $freeze = Object.freeze
const $is = Object.is
const $keys = Object.keys
const $isArray = Array.isArray
const $abs = Math.abs
const $pow = Math.pow
const $stringify = JSON.stringify
const $String = String
const $Boolean = Boolean
const $Error = Error
const $RegExp = RegExp
const $regexpTest = RegExp.prototype.test
const $strReplace = String.prototype.replace
const $numberFormat = Number
const $push = Array.prototype.push
const $pop = Array.prototype.pop
const $join = Array.prototype.join
const $strIncludes = String.prototype.includes
const $hasOwn = Object.prototype.hasOwnProperty

const push = (list, value) => $apply($push, list, [value])
const pop = (list) => $apply($pop, list, [])
const join = (list, separator) => $apply($join, list, [separator])
const owns = (target, key) => $apply($hasOwn, target, [key])
const contains = (text, part) => $apply($strIncludes, text, [part])

let suites = []
let stack = []
let sealed = false
let checks = 0

/** Start a file with nothing collected and nothing counted. */
function open() {
  suites = []
  stack = []
  sealed = false
  checks = 0
}

/**
 * Hand the file's cases over and stop collecting.
 *
 * The list leaves with the runner and the shim drops it, so nothing that loads
 * afterwards can add to it, reorder it or swap a case body out.
 */
function drain() {
  const collected = suites
  suites = []
  stack = []
  sealed = true
  return collected
}

/** Assertions since the last arm(), which is how a no-op case is spotted. */
function arm() {
  checks = 0
}

function counted() {
  return checks
}

let control = { open, drain, arm, counted }

/**
 * The runner's private door, openable once. It is called while this module's
 * importer is still the only code in the process; every later caller gets
 * null, whatever path it found this file by.
 */
export function claim() {
  const surface = control
  control = null
  return surface === null ? null : $freeze(surface)
}

export function reset() {
  open()
}

export function describe(name, fn) {
  if (sealed) return
  const parent = stack.length > 0 ? stack[stack.length - 1] : null
  const node = { name: $String(name), tests: [], parent }
  push(suites, node)
  push(stack, node)
  try {
    fn()
  } finally {
    pop(stack)
  }
}
describe.each = eachOf((name, fn) => describe(name, fn))

export function it(name, fn) {
  if (sealed) return
  const parent = stack.length > 0 ? stack[stack.length - 1] : null
  const entry = { name: $String(name), fn, suite: parent }
  if (parent) {
    push(parent.tests, entry)
  } else {
    push(suites, { name: '', tests: [entry], parent: null })
  }
}
it.each = eachOf((name, fn) => it(name, fn))
export const test = it

/**
 * Table driven cases. The title is filled the way vitest fills it, so an id
 * collected here reads the same as the one the repository's own runner prints.
 */
function fill(template, row) {
  const values = $isArray(row) ? row : [row]
  let index = 0
  return $apply($strReplace, template, [
    /%[sdifjo#%]/g,
    (token) => {
      if (token === '%%') return '%'
      if (token === '%#') return $String(index)
      const value = values[index]
      index += 1
      if (token === '%d' || token === '%i') return $String($numberFormat(value))
      if (token === '%f') return $String($numberFormat(value))
      if (token === '%j' || token === '%o') return show(value)
      return typeof value === 'string' ? value : show(value)
    },
  ])
}

function eachOf(register) {
  return (rows) => (template, fn) => {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const args = $isArray(row) ? row : [row]
      register(fill(template, row), () => {
        const call = fn
        return $apply(call, undefined, args)
      })
    }
  }
}

export function titleOf(suite, entry) {
  const names = []
  let cursor = suite
  while (cursor) {
    if (cursor.name) push(names, cursor.name)
    cursor = cursor.parent
  }
  const parts = []
  for (let index = names.length - 1; index >= 0; index -= 1) push(parts, names[index])
  push(parts, entry.name)
  return join(parts, ' > ')
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

/** Own keys carrying something, gathered without Array.prototype.filter. */
function liveKeys(value) {
  const all = $keys(value)
  const kept = []
  for (let index = 0; index < all.length; index += 1) {
    const key = all[index]
    if (value[key] !== undefined) push(kept, key)
  }
  return kept
}

function hasKey(list, key) {
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === key) return true
  }
  return false
}

function deepEqual(a, b) {
  if ($is(a, b)) return true
  if (typeof a === 'number' && typeof b === 'number' && a === b) return true
  if (!isObject(a) || !isObject(b)) return false
  if ($isArray(a) !== $isArray(b)) return false
  const left = liveKeys(a)
  const right = liveKeys(b)
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const key = left[index]
    if (!hasKey(right, key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function subsetOf(actual, expected) {
  if (!isObject(expected)) return deepEqual(actual, expected)
  if (!isObject(actual)) return false
  const wanted = $keys(expected)
  for (let index = 0; index < wanted.length; index += 1) {
    const key = wanted[index]
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
    return text === undefined ? $String(value) : text
  } catch (error) {
    return $String(value)
  }
}

function fail(message) {
  const error = new $Error(message)
  error.name = 'AssertionError'
  throw error
}

function has(value, item) {
  if (!$isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if ($is(value[index], item) || deepEqual(value[index], item)) return true
  }
  return false
}

/**
 * The matchers, written once against a check() the wrapper below supplies.
 * Nothing here reaches a global that repository code could have moved.
 */
const MATCHERS = $freeze({
  toBe(check, actual, expected) {
    check($is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`)
  },
  toEqual(check, actual, expected) {
    check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`)
  },
  toStrictEqual(check, actual, expected) {
    check(deepEqual(actual, expected), `expected ${show(actual)} to equal ${show(expected)}`)
  },
  toMatchObject(check, actual, expected) {
    check(subsetOf(actual, expected), `expected ${show(actual)} to match ${show(expected)}`)
  },
  toHaveLength(check, actual, size) {
    const length = actual === null || actual === undefined ? null : actual.length
    check(length === size, `expected length ${length === null ? 'none' : length} to be ${size}`)
  },
  toHaveProperty(check, actual, key) {
    check(isObject(actual) && owns(actual, key), `expected ${show(actual)} to have ${key}`)
  },
  toBeNull(check, actual) {
    check(actual === null, `expected ${show(actual)} to be null`)
  },
  toBeUndefined(check, actual) {
    check(actual === undefined, `expected ${show(actual)} to be undefined`)
  },
  toBeDefined(check, actual) {
    check(actual !== undefined, 'expected a defined value')
  },
  toBeTruthy(check, actual) {
    check($Boolean(actual), `expected ${show(actual)} to be truthy`)
  },
  toBeFalsy(check, actual) {
    check(!actual, `expected ${show(actual)} to be falsy`)
  },
  toBeGreaterThan(check, actual, limit) {
    check(actual > limit, `expected ${show(actual)} above ${show(limit)}`)
  },
  toBeGreaterThanOrEqual(check, actual, limit) {
    check(actual >= limit, `expected ${show(actual)} at or above ${show(limit)}`)
  },
  toBeLessThan(check, actual, limit) {
    check(actual < limit, `expected ${show(actual)} below ${show(limit)}`)
  },
  toBeLessThanOrEqual(check, actual, limit) {
    check(actual <= limit, `expected ${show(actual)} at or below ${show(limit)}`)
  },
  toBeCloseTo(check, actual, expected, precision) {
    const places = precision === undefined ? 2 : precision
    check(
      $abs(actual - expected) < $pow(10, -places) / 2,
      `expected ${show(actual)} close to ${show(expected)}`,
    )
  },
  toMatch(check, actual, pattern) {
    const text = $String(actual)
    const found =
      pattern instanceof $RegExp
        ? $apply($regexpTest, pattern, [text])
        : contains(text, $String(pattern))
    check(found, `expected ${show(actual)} to match ${pattern}`)
  },
  toBeInstanceOf(check, actual, ctor) {
    check(
      typeof ctor === 'function' && actual instanceof ctor,
      `expected ${show(actual)} to be a ${ctor && ctor.name}`,
    )
  },
  toContain(check, actual, item) {
    const found = typeof actual === 'string' ? contains(actual, item) : has(actual, item)
    check(found, `expected ${show(actual)} to contain ${show(item)}`)
  },
})

function throws(negated, actual, matcher) {
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
  const message = thrown && thrown.message ? $String(thrown.message) : $String(thrown)
  if (matcher instanceof $RegExp) {
    if (!$apply($regexpTest, matcher, [message])) {
      fail(`message ${show(message)} does not match ${matcher}`)
    }
    return
  }
  if (typeof matcher === 'string') {
    if (!contains(message, matcher)) fail(`message ${show(message)} lacks ${show(matcher)}`)
    return
  }
  if (typeof matcher === 'function') {
    if (!(thrown instanceof matcher)) fail(`thrown value is not ${matcher.name}`)
  }
}

/**
 * Every matcher counts itself before it decides anything. A case that reaches
 * the end without one is a case that asserted nothing, and the runner fails it
 * rather than crediting a body that only had to avoid throwing.
 */
function build(actual, negated) {
  const check = (condition, message) => {
    if (negated ? condition : !condition) fail(message)
  }
  const target = {}
  $defineProperty(target, 'not', {
    get() {
      return build(actual, !negated)
    },
  })
  const names = $keys(MATCHERS)
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]
    const matcher = MATCHERS[name]
    $defineProperty(target, name, {
      value: (first, second) => {
        checks += 1
        return matcher(check, actual, first, second)
      },
    })
  }
  $defineProperty(target, 'toThrow', {
    value: (matcher) => {
      checks += 1
      return throws(negated, actual, matcher)
    },
  })
  return $freeze(target)
}

export function expect(actual) {
  return build(actual, false)
}
expect.any = undefined
$freeze(expect)
$freeze(describe)
$freeze(it)

export default $freeze({ describe, it, test, expect })
