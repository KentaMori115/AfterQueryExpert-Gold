#!/bin/bash
# Verifier entrypoint (canonical frame). Patching and grading live in
# tests/grader.py; this script owns the task-specific part: run the suites,
# write machine-readable reports under /logs/verifier/, and apply any report
# fixups before grading. Edit ONLY between the RUN TESTS markers.
set -uo pipefail
trap 'if [ ! -f /logs/verifier/reward.json ] && [ ! -f /logs/verifier/reward.txt ]; then mkdir -p /logs/verifier; echo -1 > /logs/verifier/reward.txt; fi' EXIT
log() { echo "[verifier] $*"; }
cd /app || { mkdir -p /logs/verifier; exit 6; }

python3 /tests/grader.py prepare || exit $?
[ -f /logs/verifier/reward.json ] && exit 0   # model.patch didn't apply -> graded 0

# Canonical raw-output log: send every suite's combined stdout+stderr here
# (use run_log, or pipe through tee -a "$RUN_LOG" when feeding a reporter) so
# the reason a test failed is never lost. Never silence a test run.
export RUN_LOG=/logs/verifier/run.log
: > "$RUN_LOG" 2>/dev/null || true
run_log() { echo "+ $*" >> "$RUN_LOG" 2>/dev/null; "$@" 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }

# >>> RUN TESTS (task-specific) <<<
# Node 24 runs this repository's TypeScript straight from source, so the
# graded suites are driven without the installed package tree and without
# the repository's own test runner: nothing a submission adds under /app
# can stand in for the framework that decides what a case reports. The
# runner lives outside /app, reads a per-run token before any repository
# module loads, and reports each case on stdout; a python3 publisher that
# never imports repository code turns that stream into the two reports
# config.json names.
#
# The token is the whole basis of that stream, so nothing puts it anywhere
# the graded child can look. It is written into a root-owned file under a
# directory the child cannot enter, never passing through a command line
# (/proc/<pid>/cmdline is world readable) or an environment. The child
# gets it as an already-open stdin and closes it; the publisher gets it as
# an already-open fd 3. /tests is shut to everyone but root while the
# suites run, so the id whitelist is not readable either.
set +e
BASE_SHA="bb4eda665b5ba5e281155e94d4c72fee12ef2797"
VERIFY_DIR=/verify
if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then
  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"
  mkdir -p "$VERIFY_DIR" 2>/dev/null
fi
log "harness in $VERIFY_DIR"

# The suites the repository ships, and the files its own runner is
# configured by, are restored from the base commit: an edited assertion
# never stands in for a passing build.
for _pinned in "test/cage.test.ts" "test/cli.test.ts" "test/costing.test.ts" "test/cycle.test.ts" "test/design.test.ts" "test/drum.test.ts" "test/errors.test.ts" "test/examples.test.ts" "test/power.test.ts" "test/report.test.ts" "test/rope.test.ts" "test/safety.test.ts" "test/shaft.test.ts" "test/structure.test.ts" "test/units.test.ts" "test/winder.test.ts" "vitest.config.ts" "tsconfig.json" "tsconfig.build.json"; do
  git -C /app checkout -q "$BASE_SHA" -- "$_pinned" 2>>"$RUN_LOG" || log "could not restore $_pinned"
done

# node_modules is ignored, not refused: a submission can force-add a tree
# there and the grader will apply it. Nothing under it is wanted here, so
# whatever arrived tracked goes before the runner starts.
_smuggled="$(git -C /app ls-files -z node_modules 2>/dev/null | tr -dc "\0" | wc -c | tr -d " ")"
if [ "${_smuggled:-0}" != "0" ]; then
  log "removing $_smuggled tracked files under node_modules"
  git -C /app ls-files -z node_modules 2>/dev/null | (cd /app && xargs -0 -r rm -f) 2>>"$RUN_LOG"
fi

cat > "$VERIFY_DIR/shim.mjs" <<'__SHIM__'
// A dependency-free stand-in for the slice of jest this repository's suites
// use. The globals go on before anything under /app exists and go on
// unwritable, so a submission cannot swap describe, it or expect for something
// friendlier.
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

/** Somewhere for the cases and hooks a file writes outside any describe. */
function newNode(name, parent) {
  return {
    name,
    tests: [],
    parent,
    before: [],
    beforeEach: [],
    afterEach: [],
    after: [],
  }
}

/** Start a file with nothing collected and nothing counted. */
function open() {
  suites = []
  stack = []
  sealed = false
  checks = 0
  push(suites, newNode('', null))
}

/** The node a registration outside every describe belongs to. */
function current() {
  if (stack.length > 0) return stack[stack.length - 1]
  return suites[0]
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
  const parent = stack.length > 0 ? stack[stack.length - 1] : suites[0]
  const node = newNode($String(name), parent)
  push(suites, node)
  push(stack, node)
  try {
    fn()
  } finally {
    pop(stack)
  }
}
describe.each = undefined

export function it(name, fn) {
  if (sealed) return
  const parent = current()
  push(parent.tests, { name: $String(name), fn, suite: parent })
}
export const test = it

/** The four hooks these suites use, each kept on the node that declared it. */
export function beforeAll(fn) {
  if (!sealed) push(current().before, fn)
}

export function beforeEach(fn) {
  if (!sealed) push(current().beforeEach, fn)
}

export function afterEach(fn) {
  if (!sealed) push(current().afterEach, fn)
}

export function afterAll(fn) {
  if (!sealed) push(current().after, fn)
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
  toContain(check, actual, item) {
    const found = typeof actual === 'string' ? contains(actual, item) : has(actual, item)
    check(found, `expected ${show(actual)} to contain ${show(item)}`)
  },
  toMatch(check, actual, pattern) {
    const text = $String(actual)
    const found =
      pattern instanceof $RegExp ? $apply($regexpTest, pattern, [text]) : contains(text, pattern)
    check(found, `expected ${show(text)} to match ${show($String(pattern))}`)
  },
  toBeInstanceOf(check, actual, ctor) {
    const held = typeof ctor === 'function' && actual instanceof ctor
    check(held, `expected ${show(actual)} to be a ${ctor && ctor.name ? ctor.name : show(ctor)}`)
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
/**
 * The framework's own "this line should not have been reached". A case that
 * calls it has failed by arriving there, so it counts itself and throws.
 */
expect.unreachable = (says) => {
  checks += 1
  fail(says === undefined ? 'this line should not have been reached' : $String(says))
}
$freeze(expect)
$freeze(describe)
$freeze(it)
$freeze(beforeAll)
$freeze(beforeEach)
$freeze(afterEach)
$freeze(afterAll)

/**
 * The suites in this repository reach for these by name rather than importing
 * them. They go on now, while this module is the only thing loaded, and they
 * go on unwritable and unconfigurable, so a submitted module cannot put a
 * quieter expect in their place.
 */
const GLOBALS = { describe, it, test, expect, beforeAll, beforeEach, afterEach, afterAll }
const GLOBAL_NAMES = $keys(GLOBALS)
for (let index = 0; index < GLOBAL_NAMES.length; index += 1) {
  const name = GLOBAL_NAMES[index]
  try {
    $defineProperty(globalThis, name, {
      value: GLOBALS[name],
      writable: false,
      enumerable: false,
      configurable: false,
    })
  } catch (error) {
    /* a runtime that already froze the global is not a reason to stop */
  }
}

export default $freeze({ describe, it, test, expect })
__SHIM__

cat > "$VERIFY_DIR/hooks.mjs" <<'__HOOKS__'
// Resolution for a repository that is normally bundled: TypeScript sources by
// extensionless specifier, the "@/" and "@lib/" aliases from tsconfig, and the
// test framework entry point, which this run answers with the local stand-in.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let APP = '/app'
let SHIM = '/verify/shim.mjs'
let ANCHOR = ''
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']

function fileAt(base) {
  try {
    if (existsSync(base) && statSync(base).isFile()) return base
  } catch (error) {
    return null
  }
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) return base + extension
  }
  for (const extension of EXTENSIONS) {
    const candidate = join(base, 'index' + extension)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The registrar hands the two paths over here, ahead of any resolution. */
export async function initialize(data) {
  if (data && typeof data === 'object') {
    if (typeof data.app === 'string' && data.app) APP = data.app
    if (typeof data.shim === 'string' && data.shim) SHIM = data.shim
    if (typeof data.anchor === 'string' && data.anchor) {
      // A parent has to be a URL, not a path: the resolver reads the package
      // scope off it and throws Invalid URL on anything else.
      ANCHOR = data.anchor.startsWith('file:') ? data.anchor : pathToFileURL(data.anchor).href
    }
  }
}

export async function resolve(specifier, context, next) {
  if (specifier === '@jest/globals' || specifier === 'vitest') {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true }
  }

  let target = null
  if (specifier.startsWith('@lib/')) {
    target = join(APP, 'lib', specifier.slice(5))
  } else if (specifier.startsWith('@/')) {
    target = join(APP, specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parent =
      context.parentURL && context.parentURL.startsWith('file:')
        ? dirname(fileURLToPath(context.parentURL))
        : APP
    target = resolvePath(parent, specifier)
  }

  if (target) {
    let found = fileAt(target)
    if (!found && target.endsWith('.js')) found = fileAt(target.slice(0, -3))
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }

  // A package name resolves from a tree the submission cannot reach. /app has
  // its own copy of the same packages, and a patch may add files anywhere
  // under it, so uuid or firebase-admin loaded from there would be whatever
  // the submission last wrote. The anchor points at the root-owned copy; where
  // there is none, resolution falls through unchanged rather than refusing.
  if (ANCHOR && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:')) {
    try {
      return await next(specifier, { ...context, parentURL: ANCHOR })
    } catch (error) {
      /* not in the pinned tree: let the default resolver answer */
    }
  }

  return next(specifier, context)
}
__HOOKS__

cat > "$VERIFY_DIR/register.mjs" <<'__REGISTER__'
// Installs the resolver on the loader thread and hands it its two paths
// directly, so nothing it needs has to survive in the environment once the
// runner starts loading repository code.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(process.env.HARNESS_HOOKS || '/verify/hooks.mjs'), {
  data: {
    app: process.env.HARNESS_APP || '/app',
    shim: process.env.HARNESS_SHIM || '/verify/shim.mjs',
    anchor: process.env.HARNESS_ANCHOR || '',
  },
})
__REGISTER__

cat > "$VERIFY_DIR/run.mjs" <<'__RUN__'
// Runs one selection of suites and reports each case on stdout under a token
// the publisher hands in.
//
// Verdict generation is kept out of the repository's reach rather than merely
// ahead of it. The builtins this file writes and resolves with are captured
// here, at the top; the shim's control surface is claimed on the same line and
// is gone before any dynamic import runs, so a submission that finds either
// file on disk cannot reach the case list, the counter or the stream. The
// cases for a file are drained before the first of them runs, and a case that
// asserts nothing is failed rather than credited: a named no-op body has
// nothing to gain.
import { closeSync, readFileSync, writeSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { claim, expect, titleOf } from './shim.mjs'

const emit = writeSync
const read = readFileSync
const close = closeSync
const apply = Reflect.apply
const asString = String
const argv = apply(Array.prototype.slice, process.argv, [2])
const APP = process.env.HARNESS_APP || '/app'

const control = claim()
if (control === null) {
  emit(2, 'the harness control surface was already claimed\n')
  process.exit(4)
}

// Nothing loaded from /app needs to know where the harness lives.
delete process.env.HARNESS_APP
delete process.env.HARNESS_SHIM
delete process.env.HARNESS_HOOKS

// The token is read once and the descriptor is shut behind it. It arrives on a
// file the graded child cannot open for itself, so leaving fd 0 open would let
// repository code read the same bytes back at offset zero and sign its own
// verdicts.
let token = ''
try {
  token = asString(read(0, 'utf8')).trim()
} catch (error) {
  token = ''
}
try {
  close(0)
} catch (error) {
  // already gone
}
if (!token) {
  emit(2, 'no run token on stdin\n')
  process.exit(3)
}

let reported = 0

// The nodes a case sits under, outermost first, which is the order hooks run
// in on the way down and the reverse of the order they run in on the way up.
function ancestry(suite) {
  const chain = []
  let cursor = suite
  while (cursor) {
    apply(Array.prototype.push, chain, [cursor])
    cursor = cursor.parent
  }
  const ordered = []
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    apply(Array.prototype.push, ordered, [chain[index]])
  }
  return ordered
}

// Run one hook list over a chain. Returns a message on the first throw.
async function runHooks(chain, name, upward) {
  for (let step = 0; step < chain.length; step += 1) {
    const index = upward ? chain.length - 1 - step : step
    const list = chain[index][name]
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        return `${name} :: ${asString(error && error.message ? error.message : error)}`
      }
    }
  }
  return ''
}

// Run the once-per-suite hooks the first time a case under a node is reached.
async function openOnce(suite, opened, file, title) {
  const chain = ancestry(suite)
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]
    let seen = false
    for (let o = 0; o < opened.length; o += 1) {
      if (opened[o] === node) seen = true
    }
    if (seen) continue
    apply(Array.prototype.push, opened, [node])
    const list = node.before
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        note(`[hook] ${file} > ${title} :: ${asString(error && error.message ? error.message : error)}`)
        return true
      }
    }
  }
  return false
}

// Run the closing hooks of every node a case was reached under.
async function closeAll(opened, file) {
  for (let index = opened.length - 1; index >= 0; index -= 1) {
    const list = opened[index].after
    if (!list) continue
    for (let h = 0; h < list.length; h += 1) {
      try {
        await list[h]()
      } catch (error) {
        note(`[hook] ${file} :: ${asString(error && error.message ? error.message : error)}`)
      }
    }
  }
}

function say(status, file, title) {
  emit(1, `V ${token} ${status} ${file}\t${title}\n`)
  reported += 1
}

function note(text) {
  try {
    emit(2, text + '\n')
  } catch (error) {
    /* the log is best effort */
  }
}

for (const file of argv) {
  control.open()
  const absolute = resolvePath(APP, file)
  try {
    await import(pathToFileURL(absolute).href)
  } catch (error) {
    note(`[load] ${file} :: ${asString(error && error.stack ? error.stack : error)}`)
    continue
  }
  const collected = control.drain()
  const opened = []
  for (let s = 0; s < collected.length; s += 1) {
    const suite = collected[s]
    const cases = suite.tests
    for (let c = 0; c < cases.length; c += 1) {
      const entry = cases[c]
      const title = titleOf(suite, entry)
      if (typeof entry.fn !== 'function') {
        note(`[shape] ${file} > ${title} :: case body is not a function`)
        say('fail', file, title)
        continue
      }
      const failure = await openOnce(suite, opened, file, title)
      if (failure) {
        say('fail', file, title)
        continue
      }
      control.arm()
      let broke = await runHooks(ancestry(suite), 'beforeEach', false)
      if (!broke) {
        try {
          await entry.fn({ expect })
        } catch (error) {
          broke = asString(error && error.message ? error.message : error)
        }
      }
      const after = await runHooks(ancestry(suite), 'afterEach', true)
      if (broke || after) {
        note(`[fail] ${file} > ${title} :: ${broke || after}`)
        say('fail', file, title)
        continue
      }
      if (control.counted() === 0) {
        note(`[empty] ${file} > ${title} :: the case asserted nothing`)
        say('fail', file, title)
        continue
      }
      say('pass', file, title)
    }
  }
  await closeAll(opened, file)
}

emit(1, `END ${token} ${reported}\n`)
__RUN__

cat > "$VERIFY_DIR/publish.py" <<'__PUBLISH__'
#!/usr/bin/env python3
"""Turn one selection's verdict stream into a JUnit report.

The runner is an unprivileged child. This publisher never imports repository
code, holds the whitelist itself, and writes a report for every declared id
whatever the child did: an id the stream never carried, or carried twice, or
carried after the closing line, is published as failed.

The run token arrives on file descriptor 3, never on the command line and never
in the environment. /proc/<pid>/cmdline is world readable, so a token passed as
an argument would be legible to the very code it exists to keep out; fd 3 is
opened by the parent before privileges are dropped and is not inherited by the
graded child.
"""
import json
import os
import sys

TESTS_DIR = os.environ.get("TESTS_DIR", "/tests")


def declared(bucket):
    with open(os.path.join(TESTS_DIR, "config.json")) as handle:
        config = json.load(handle)
    key = "f2p_node_ids" if bucket == "new" else "p2p_node_ids"
    return [str(x).strip() for x in config.get(key, []) if str(x).strip()]


def collect(token):
    """stream -> ({id: status}, complaint or None)"""
    seen = {}
    closed = False
    counted = 0
    complaint = None
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        if not line:
            continue
        if line.startswith("END "):
            parts = line.split(" ")
            if len(parts) != 3 or parts[1] != token:
                complaint = "closing line did not carry the run token"
                break
            closed = True
            try:
                promised = int(parts[2])
            except ValueError:
                complaint = "closing line carried no count"
                break
            if promised != counted:
                complaint = f"closing line promised {promised} verdicts, stream carried {counted}"
            continue
        if not line.startswith("V "):
            continue
        if closed:
            complaint = "a verdict arrived after the closing line"
            break
        parts = line.split(" ", 3)
        if len(parts) != 4:
            continue
        _, carried, status, body = parts
        if carried != token:
            complaint = "a verdict did not carry the run token"
            break
        if "\t" not in body:
            continue
        suite, name = body.split("\t", 1)
        node = f"{suite.strip()}.{name.strip()}"
        counted += 1
        if node in seen:
            complaint = f"{node} reported more than once"
            seen[node] = "failed"
            continue
        seen[node] = "passed" if status == "pass" else "failed"
    if not closed and complaint is None:
        complaint = "the run ended without a closing line"
    return seen, complaint


def escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_report(path, ids, seen, complaint):
    rows = []
    failures = 0
    for node in ids:
        suite, _, name = node.partition(".")
        status = seen.get(node, "missing")
        if status == "passed" and complaint is None:
            rows.append(f'    <testcase classname="{escape(suite)}" name="{escape(name)}"/>')
            continue
        failures += 1
        reason = complaint or ("no verdict reported" if status == "missing" else "assertion failed")
        rows.append(
            f'    <testcase classname="{escape(suite)}" name="{escape(name)}">'
            f'<failure message="{escape(reason)}"/></testcase>'
        )
    body = "\n".join(rows)
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuites tests="{len(ids)}" failures="{failures}">\n'
        f'  <testsuite name="verifier" tests="{len(ids)}" failures="{failures}">\n'
        f"{body}\n"
        "  </testsuite>\n"
        "</testsuites>\n"
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(document)
    return failures


def run_token():
    """Read the token off fd 3 and close it, so the value lives only here."""
    try:
        handle = os.fdopen(3, "r")
    except OSError:
        return ""
    try:
        return handle.read().strip()
    finally:
        handle.close()


def main():
    out = ""
    bucket = "base"
    args = sys.argv[1:]
    for index, arg in enumerate(args):
        if arg == "--out" and index + 1 < len(args):
            out = args[index + 1]
        elif arg == "--bucket" and index + 1 < len(args):
            bucket = args[index + 1]
    token = run_token()
    ids = declared(bucket)
    if not token:
        write_report(out, ids, {}, "the run carried no token")
        return 0
    seen, complaint = collect(token)
    if complaint:
        print(f"[verifier] {bucket} selection rejected: {complaint}", flush=True)
    failures = write_report(out, ids, seen, complaint)
    print(f"[verifier] {bucket} selection: {len(ids) - failures} of {len(ids)} passed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # never leave the report unwritten
        try:
            bucket = "new" if "--bucket" in sys.argv and sys.argv[sys.argv.index("--bucket") + 1] == "new" else "base"
            out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/logs/verifier/report.xml"
            write_report(out, declared(bucket), {}, f"publisher error: {error}")
        except Exception:
            pass
        sys.exit(0)
__PUBLISH__

# This repository declares no runtime dependencies and the harness imports
# no package, so there is no tree to pin resolution to and the anchor stays
# empty. Resolution never leaves /app and the harness directory.
HARNESS_ANCHOR=""
export HARNESS_ANCHOR

chmod 0444 "$VERIFY_DIR"/*.mjs "$VERIFY_DIR"/*.py 2>/dev/null
chmod 0555 "$VERIFY_DIR" 2>/dev/null
chown -R root:root "$VERIFY_DIR" 2>/dev/null

# Where the per-run tokens are written. Mode 0700 and root owned: the
# child can neither list it nor open what is in it, and holds a token only
# as a descriptor handed to it before privileges were dropped.
TOKEN_DIR="$VERIFY_DIR/run"
mkdir -p "$TOKEN_DIR" 2>/dev/null
chown root:root "$TOKEN_DIR" 2>/dev/null
chmod 0700 "$TOKEN_DIR" 2>/dev/null

NODE_FLAGS="--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON"
AS_NOBODY=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"
fi

run_selection() {
  _bucket="$1"; _out="$2"; shift 2
  _tokf="$TOKEN_DIR/$_bucket"
  rm -f "$_tokf" 2>/dev/null
  ( umask 077; head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \n" > "$_tokf" ) 2>/dev/null
  if [ ! -s "$_tokf" ]; then
    ( umask 077; { date +%s%N; echo "$$ $_bucket"; } 2>/dev/null | cksum | tr -d " \n" > "$_tokf" ) 2>/dev/null
  fi
  chmod 0400 "$_tokf" 2>/dev/null
  # One descriptor for each end of the pipeline, and then the name goes.
  # What is left cannot be opened by path by anyone, so the token survives
  # even a run where privileges could not be dropped; the child closes its
  # copy before the first repository module loads.
  exec 7<"$_tokf" 8<"$_tokf" 2>/dev/null
  rm -f "$_tokf" 2>/dev/null
  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null
  HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \
    HARNESS_ANCHOR="$HARNESS_ANCHOR" \
    timeout 900 $AS_NOBODY node $NODE_FLAGS --import "$VERIFY_DIR/register.mjs" "$VERIFY_DIR/run.mjs" "$@" \
      <&8 8<&- 7<&- 2>>"$RUN_LOG" \
    | python3 -I "$VERIFY_DIR/publish.py" --bucket "$_bucket" --out "$_out" 3<&7 7<&- 8<&- 2>&1 | tee -a "$RUN_LOG"
  exec 7<&- 8<&- 2>/dev/null
}

cd /app || exit 6

# The whitelist lives in /tests/config.json. The publisher reads it as
# root; nothing running out of /app has any business with it, so the
# directory is shut for the length of the run and opened again after.
TESTS_LOCKED=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && [ -d /tests ]; then
  if chmod 0700 /tests 2>/dev/null; then TESTS_LOCKED=1; fi
fi

run_selection base /logs/verifier/base_junit.xml "test/cage.test.ts" "test/cli.test.ts" "test/costing.test.ts" "test/cycle.test.ts" "test/design.test.ts" "test/drum.test.ts" "test/errors.test.ts" "test/examples.test.ts" "test/power.test.ts" "test/report.test.ts" "test/rope.test.ts" "test/safety.test.ts" "test/shaft.test.ts" "test/structure.test.ts" "test/units.test.ts" "test/winder.test.ts"
run_selection new /logs/verifier/new_junit.xml "test/pit/hanging-rope.test.ts" "test/pit/stopped-wind.test.ts" "test/pit/three-collieries.test.ts" "test/pit/signing-off.test.ts"

[ -n "$TESTS_LOCKED" ] && chmod 0755 /tests 2>/dev/null
rm -rf "$TOKEN_DIR" 2>/dev/null
set -e
# >>> END RUN TESTS <<<

# Surface raw suite output into stdout (the harness captures it) so failures
# stay debuggable even when a framework report omits the reason.
_seen=""
for _rl in "$RUN_LOG" /logs/verifier/*_run.log /logs/verifier/*-run.log /logs/verifier/*.log /logs/verifier/*.out; do
  [ -f "$_rl" ] && [ -s "$_rl" ] || continue
  case " $_seen " in *" $_rl "*) continue ;; esac
  case "${_rl##*/}" in *convert*.log|ctrf*.log|junit*.log) continue ;; esac
  _seen="$_seen $_rl"
  echo "===== raw suite output: ${_rl##*/} ====="
  cat "$_rl"
done 2>/dev/null
echo "===== grade ====="

python3 /tests/grader.py grade
log "reward.json=$(cat /logs/verifier/reward.json 2>/dev/null)"

# Uniform top level: keep only the canonical artifacts in /logs/verifier and
# move every framework-native report/log under reports/.
mkdir -p /logs/verifier/reports 2>/dev/null
for _f in /logs/verifier/*; do
  case "${_f##*/}" in
    reward.json|reward.txt|ctrf.json|run.log|test-stdout.txt|reports) continue ;;
  esac
  [ -f "$_f" ] && mv -f "$_f" /logs/verifier/reports/ 2>/dev/null
done
