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
# Node 24 runs this repository's TypeScript without a build step, so the
# suites are driven straight from source: no package tree is installed in
# the image, and none is needed. The runner lives outside /app, reads a
# per-run token before any repository module loads, and reports each case
# on stdout; a python3 publisher that never imports repository code turns
# that stream into the two reports config.json names.
set +e
BASE_SHA="710f4235a38468a48b96cff885b1104ee4f9f05a"
VERIFY_DIR=/verify
if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then
  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"
  mkdir -p "$VERIFY_DIR" 2>/dev/null
fi
log "harness in $VERIFY_DIR"

# The graded suites the repository ships are restored from the base commit,
# so an edited assertion never stands in for a passing build.
for _suite in "lib/ops/billing/ledger.test.ts" "lib/ops/capacity/planner.test.ts" "lib/ops/clock.test.ts" "lib/ops/concurrency/etag.test.ts" "lib/ops/events/project.test.ts" "lib/ops/graph/dag.test.ts" "lib/ops/invoices/builder.test.ts" "lib/ops/jobs/queue.test.ts" "lib/ops/merge/document.test.ts" "lib/ops/query/parser.test.ts" "lib/ops/rate-limit/limiter.test.ts" "lib/ops/rbac/engine.test.ts" "lib/ops/routing/digest.test.ts" "lib/ops/schedule/rrule.test.ts" "lib/ops/timeseries/buckets.test.ts" "lib/ops/webhooks/delivery.test.ts" "lib/ops/workflow/machine.test.ts" "lib/paginate.test.ts"; do
  git -C /app checkout -q "$BASE_SHA" -- "$_suite" 2>>"$RUN_LOG" || log "could not restore $_suite"
done

cat > "$VERIFY_DIR/shim.mjs" <<'__SHIM__'
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
__SHIM__

cat > "$VERIFY_DIR/hooks.mjs" <<'__HOOKS__'
// Resolution for a repository that is normally bundled: TypeScript sources by
// extensionless specifier, the "@/" root alias from tsconfig, and the vitest
// entry point, which this run answers with the local stand-in.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const APP = process.env.HARNESS_APP || '/app'
const SHIM = process.env.HARNESS_SHIM || '/verify/shim.mjs'
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

export async function resolve(specifier, context, next) {
  if (specifier === 'vitest' || specifier === 'vitest/config') {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true }
  }

  let target = null
  if (specifier.startsWith('@/')) {
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

  return next(specifier, context)
}
__HOOKS__

cat > "$VERIFY_DIR/register.mjs" <<'__REGISTER__'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(process.env.HARNESS_HOOKS || '/verify/hooks.mjs'))
__REGISTER__

cat > "$VERIFY_DIR/run.mjs" <<'__RUN__'
// Runs one selection of suites and reports each case on stdout under a token
// the publisher hands in. Everything the reporting path needs is captured
// before a line of repository code is imported.
import { readFileSync, writeSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, reset, suites, titleOf } from './shim.mjs'

const emit = writeSync
const read = readFileSync
const APP = process.env.HARNESS_APP || '/app'

let token = ''
try {
  token = String(read(0, 'utf8')).trim()
} catch (error) {
  token = ''
}
if (!token) {
  emit(2, 'no run token on stdin\n')
  process.exit(3)
}

const files = process.argv.slice(2)
let reported = 0

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

for (const file of files) {
  reset()
  const absolute = resolvePath(APP, file)
  try {
    await import(pathToFileURL(absolute).href)
  } catch (error) {
    note(`[load] ${file} :: ${String(error && error.stack ? error.stack : error)}`)
    continue
  }
  const collected = suites.slice()
  for (const suite of collected) {
    for (const entry of suite.tests) {
      const title = titleOf(suite, entry)
      try {
        await entry.fn({ expect })
        say('pass', file, title)
      } catch (error) {
        note(`[fail] ${file} > ${title} :: ${String(error && error.message ? error.message : error)}`)
        say('fail', file, title)
      }
    }
  }
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


def main():
    token = ""
    out = ""
    bucket = "base"
    args = sys.argv[1:]
    for index, arg in enumerate(args):
        if arg == "--token" and index + 1 < len(args):
            token = args[index + 1]
        elif arg == "--out" and index + 1 < len(args):
            out = args[index + 1]
        elif arg == "--bucket" and index + 1 < len(args):
            bucket = args[index + 1]
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

chmod 0444 "$VERIFY_DIR"/* 2>/dev/null
chmod 0555 "$VERIFY_DIR" 2>/dev/null
chown -R root:root "$VERIFY_DIR" 2>/dev/null

NODE_FLAGS="--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON"
AS_NOBODY=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"
fi

run_selection() {
  _bucket="$1"; _out="$2"; shift 2
  _token="$(head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \n")"
  [ -n "$_token" ] || _token="run-$$-$_bucket"
  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null
  printf %s "$_token" | \
    HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \
    timeout 900 $AS_NOBODY node $NODE_FLAGS --import "$VERIFY_DIR/register.mjs" "$VERIFY_DIR/run.mjs" "$@" \
      2>>"$RUN_LOG" | python3 -I "$VERIFY_DIR/publish.py" --token "$_token" --bucket "$_bucket" --out "$_out" 2>&1 | tee -a "$RUN_LOG"
}

cd /app || exit 6
run_selection base /logs/verifier/base_junit.xml "lib/ops/billing/ledger.test.ts" "lib/ops/capacity/planner.test.ts" "lib/ops/clock.test.ts" "lib/ops/concurrency/etag.test.ts" "lib/ops/events/project.test.ts" "lib/ops/graph/dag.test.ts" "lib/ops/invoices/builder.test.ts" "lib/ops/jobs/queue.test.ts" "lib/ops/merge/document.test.ts" "lib/ops/query/parser.test.ts" "lib/ops/rate-limit/limiter.test.ts" "lib/ops/rbac/engine.test.ts" "lib/ops/routing/digest.test.ts" "lib/ops/schedule/rrule.test.ts" "lib/ops/timeseries/buckets.test.ts" "lib/ops/webhooks/delivery.test.ts" "lib/ops/workflow/machine.test.ts" "lib/paginate.test.ts" "checks/queue-invariants.spec.ts"
run_selection new /logs/verifier/new_junit.xml "checks/fence-order.spec.ts"
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
