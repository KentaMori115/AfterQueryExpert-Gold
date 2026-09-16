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
# Node 24 runs this repository's TypeScript straight from source, so both
# selections are driven without the installed test runner and without any
# configuration file out of /app: nothing a submission adds under /app can
# stand in for the framework that decides what a case reports. The runner
# lives outside /app, reads a per-run token before a single repository module
# loads, and reports each case on stdout. A python3 publisher that never
# imports repository code turns that stream into the two reports config.json
# names, and publishes every declared id whatever the child did.
set +e
mkdir -p /logs/verifier

VERIFY_DIR=/verify
if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then
  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/bw-verify)"
  mkdir -p "$VERIFY_DIR" 2>/dev/null
fi
log "harness in $VERIFY_DIR"

cat > "$VERIFY_DIR/shim.mjs" <<'__SHIM__'
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
__SHIM__

cat > "$VERIFY_DIR/hooks.mjs" <<'__HOOKS__'
// Resolution for a verifier that runs the repository's TypeScript directly:
// the vitest specifier lands on the shim, workspace names land on package
// sources, and the ".js" specifiers TypeScript writes land on the ".ts" beside
// them. Nothing here reads a configuration file out of the tree under test.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let APP = "/app";
let SHIM = "/verify/shim.mjs";

const PACKAGES = {
  "@biomeweaver/fixed-point": "fixed-point",
  "@biomeweaver/capsule-source": "capsule-source",
  "@biomeweaver/biome-model": "biome-model",
  "@biomeweaver/calendar-engine": "calendar-engine",
  "@biomeweaver/resource-engine": "resource-engine",
  "@biomeweaver/population-engine": "population-engine",
  "@biomeweaver/predation-engine": "predation-engine",
  "@biomeweaver/tick-runtime": "tick-runtime",
  "@biomeweaver/flow-explanations": "flow-explanations",
  "@biomeweaver/run-store": "run-store",
  "@biomeweaver/biome-reports": "biome-reports",
  "@biomeweaver/cli": "biomeweaver-cli",
  biomeweaver: "biomeweaver",
};

export function initialize(data) {
  APP = data?.app ?? APP;
  SHIM = data?.shim ?? SHIM;
}

export function resolve(specifier, context, next) {
  if (specifier === "vitest") {
    return { url: pathToFileURL(SHIM).href, shortCircuit: true };
  }
  const pkg = PACKAGES[specifier];
  if (pkg) {
    return {
      url: pathToFileURL(`${APP}/packages/${pkg}/src/index.ts`).href,
      shortCircuit: true,
    };
  }
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
    const parent = dirname(fileURLToPath(context.parentURL));
    const candidate = resolvePath(parent, `${specifier.slice(0, -3)}.ts`);
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
__HOOKS__

cat > "$VERIFY_DIR/run.mjs" <<'__RUN__'
// Run the cases in the files named on the command line and write one JUnit
// report. Ids are "<path relative to the app>.<describe chain> > <case>", the
// same shape the project runner reports.
import { register } from "node:module";
import { closeSync, readSync, writeSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.env["HARNESS_APP"] ?? "/app";
const SHIM = process.env["HARNESS_SHIM"] ?? "/verify/shim.mjs";
const HOOKS = process.env["HARNESS_HOOKS"] ?? "/verify/hooks.mjs";

// The run token arrives as an already open standard input and the descriptor
// is shut behind it, before a single module of the repository loads. It never
// reaches a command line: /proc/<pid>/cmdline is world readable, and the point
// of the token is to be unavailable to the code being graded.
const write = writeSync;
let token = "";
try {
  const buffer = Buffer.alloc(4096);
  const read = readSync(0, buffer, 0, buffer.length, null);
  token = buffer.subarray(0, read).toString("utf8").trim();
} catch {
  token = "";
}
try {
  closeSync(0);
} catch {
  /* a closed descriptor is what was wanted anyway */
}

register(pathToFileURL(HOOKS), { data: { app: APP, shim: SHIM } });

const shim = await import(pathToFileURL(SHIM).href);

function clean(value) {
  return String(value).replace(/[\u0000-\u001f]/g, " ");
}

function say(status, classname, name) {
  write(1, `V ${token} ${status} ${clean(classname)}\t${clean(name)}\n`);
  reported += 1;
}

let reported = 0;
let failures = 0;

for (const argument of process.argv.slice(2)) {
  const file = resolve(APP, argument);
  const classname = relative(APP, file);
  let cases = [];
  try {
    await import(pathToFileURL(file).href);
    cases = shim.drain();
  } catch (error) {
    shim.drain();
    failures += 1;
    write(2, `[harness] ${classname} did not load: ${error}\n`);
    continue;
  }
  for (const item of cases) {
    const name = [...item.path, item.title].join(" > ");
    try {
      const outcome = item.body();
      if (outcome && typeof outcome.then === "function") {
        await outcome;
      }
      say("pass", classname, name);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      write(2, `[harness] ${classname} ${name}: ${message}\n`);
      say("fail", classname, name);
    }
  }
}

write(1, `END ${token} ${reported}\n`);
process.exit(failures === 0 ? 0 : 1);
__RUN__

cat > "$VERIFY_DIR/publish.py" <<'__PUBLISH__'
#!/usr/bin/env python3
"""Turn one selection's verdict stream into a JUnit report.

The runner is an unprivileged child of this process. The publisher never
imports repository code, holds the whitelist itself, and writes a report for
every declared id whatever the child did: an id the stream never carried, or
carried twice, or carried after the closing line, is published as failed.

The run token arrives on file descriptor 3, never on a command line and never
in the environment. /proc/<pid>/cmdline is world readable, so a token passed as
an argument would be legible to the very code it exists to keep out.
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


def split_node(node):
    """A node id is <file>.<case>, and the file name carries dots of its own."""
    head, sep, name = node.partition(".test.ts.")
    if sep:
        return head + ".test.ts", name
    head, sep, name = node.rpartition(".")
    return (head, name) if sep else (node, node)


def write_report(path, ids, seen, complaint):
    rows = []
    failures = 0
    for node in ids:
        suite, name = split_node(node)
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
    except Exception as error:  # never leave a report unwritten
        try:
            argv = sys.argv
            bucket = argv[argv.index("--bucket") + 1] if "--bucket" in argv else "base"
            out = argv[argv.index("--out") + 1] if "--out" in argv else "/logs/verifier/report.xml"
            write_report(out, declared(bucket), {}, f"publisher error: {error}")
        except Exception:
            pass
        sys.exit(0)
__PUBLISH__

chmod 0444 "$VERIFY_DIR"/*.mjs "$VERIFY_DIR"/*.py 2>/dev/null
chmod 0555 "$VERIFY_DIR" 2>/dev/null
chown -R root:root "$VERIFY_DIR" 2>/dev/null

# The suites the repository ships come back from the base commit before
# anything runs: an edited assertion must never stand in for a passing build.
BASE_SHA="$(python3 -c 'import json;print(json.load(open("/tests/config.json")).get("base_commit",""))' 2>/dev/null)"
if [ -n "$BASE_SHA" ]; then
  for _pinned in "ecosystem-lab/cli/commands.cli.test.ts" "ecosystem-lab/complete-biomes/crystal-tundra.biome.test.ts" "ecosystem-lab/invalid-models/invalid.biome.test.ts" "ecosystem-lab/properties/conservation.test.ts" "ecosystem-lab/properties/determinism.test.ts" "ecosystem-lab/properties/locale.test.ts" "ecosystem-lab/properties/metamorphic.test.ts" "packages/biome-model/src/compile.test.ts" "packages/biome-model/src/decode.catalog.test.ts" "packages/biome-model/src/identifiers.test.ts" "packages/biome-model/src/species.catalog.test.ts" "packages/biome-reports/src/render.test.ts" "packages/biomeweaver-cli/src/commands.catalog.test.ts" "packages/biomeweaver-cli/src/options.test.ts" "packages/biomeweaver/src/baseline-guard.test.ts" "packages/calendar-engine/src/seasons.test.ts" "packages/capsule-source/src/diagnostics/diagnostic.test.ts" "packages/capsule-source/src/discovery/discover.test.ts" "packages/capsule-source/src/gather/fingerprint.test.ts" "packages/capsule-source/src/gather/gather.test.ts" "packages/capsule-source/src/json/parse-json.test.ts" "packages/capsule-source/src/yaml/parse-yaml.test.ts" "packages/fixed-point/src/arithmetic.test.ts" "packages/fixed-point/src/catalog.test.ts" "packages/fixed-point/src/coverage.test.ts" "packages/fixed-point/src/parse.test.ts" "packages/fixed-point/src/rounding.test.ts" "packages/flow-explanations/src/catalog.test.ts" "packages/flow-explanations/src/flow.test.ts" "packages/population-engine/src/cohorts.test.ts" "packages/population-engine/src/stages.test.ts" "packages/predation-engine/src/consume.test.ts" "packages/resource-engine/src/allocate.test.ts" "packages/resource-engine/src/renew.test.ts" "packages/run-store/src/store.test.ts" "packages/tick-runtime/src/advance.test.ts" "vitest.shared.ts" "vitest.unit.config.ts" "vitest.biomes.config.ts" "vitest.properties.config.ts" "vitest.cli.config.ts" "tsconfig.json" "tsconfig.base.json" "package.json" "ecosystem-lab/helpers/paths.ts"; do
    git -C /app checkout -q "$BASE_SHA" -- "$_pinned" 2>>"$RUN_LOG" || log "could not restore $_pinned"
  done
else
  log "WARNING: no base commit in config.json, shipped suites not restored"
fi

# node_modules is ignored by the repository, not refused: a submission can
# force-add a tree there and the grader will apply it. Whatever arrived
# tracked goes before the runner starts.
_smuggled="$(git -C /app ls-files -z node_modules 2>/dev/null | tr -dc "\0" | wc -c | tr -d " ")"
if [ "${_smuggled:-0}" != "0" ]; then
  log "removing $_smuggled tracked files under node_modules"
  git -C /app ls-files -z node_modules 2>/dev/null | (cd /app && xargs -0 -r rm -f) 2>>"$RUN_LOG"
fi

# Where the per-run tokens are written. Mode 0700 and root owned: the child can
# neither list the directory nor open what is in it, and holds a token only as
# a descriptor handed over before privileges were dropped.
TOKEN_DIR="$VERIFY_DIR/run"
mkdir -p "$TOKEN_DIR" 2>/dev/null
chown root:root "$TOKEN_DIR" 2>/dev/null
chmod 0700 "$TOKEN_DIR" 2>/dev/null

# The graded child runs unprivileged, and the suites it runs write run
# snapshots into the capsule they simulate, so the tree under test is handed to
# the same unprivileged user. Nothing it can reach that way is used for
# grading: the harness, the whitelist and the reports all stay with root.
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
  chown -R 65534:65534 /app 2>/dev/null || log "could not hand /app to the run user"
fi

# TypeScript runs from source, so the interpreter has to transform it. Take the
# quietest set of flags this node accepts and say which one that was.
NODE_FLAGS=""
for _candidate in \
  "--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON" \
  "--experimental-transform-types" \
  "--experimental-strip-types" \
  ""; do
  if node $_candidate -e "" >/dev/null 2>&1; then
    NODE_FLAGS="$_candidate"
    break
  fi
done
log "node flags: ${NODE_FLAGS:-none}"
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
  # One descriptor for each end of the pipeline, and then the name goes. What
  # is left cannot be opened by path by anyone, so the token survives even a
  # run where privileges could not be dropped; the child shuts its copy before
  # the first repository module loads.
  exec 7<"$_tokf" 8<"$_tokf" 2>/dev/null
  rm -f "$_tokf" 2>/dev/null
  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null
  HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \
    timeout 900 $AS_NOBODY node $NODE_FLAGS "$VERIFY_DIR/run.mjs" "$@" <&8 8<&- 7<&- 2>>"$RUN_LOG" \
    | python3 "$VERIFY_DIR/publish.py" --bucket "$_bucket" --out "$_out" 3<&7 7<&- 8<&-
  exec 7<&- 8<&- 2>/dev/null
}

if ! command -v node >/dev/null 2>&1; then
  log "ERROR: no node on PATH, publishing every case as failed"
fi

log "running the settlement cases"
run_selection new /logs/verifier/new_junit.xml "packages/predation-engine/src/rationing.test.ts" "packages/predation-engine/src/saturation.test.ts"

log "running the rest of the suite"
run_selection base /logs/verifier/base_junit.xml "ecosystem-lab/cli/commands.cli.test.ts" "ecosystem-lab/complete-biomes/crystal-tundra.biome.test.ts" "ecosystem-lab/invalid-models/invalid.biome.test.ts" "ecosystem-lab/properties/conservation.test.ts" "ecosystem-lab/properties/determinism.test.ts" "ecosystem-lab/properties/locale.test.ts" "ecosystem-lab/properties/metamorphic.test.ts" "packages/biome-model/src/compile.test.ts" "packages/biome-model/src/decode.catalog.test.ts" "packages/biome-model/src/identifiers.test.ts" "packages/biome-model/src/species.catalog.test.ts" "packages/biome-reports/src/render.test.ts" "packages/biomeweaver-cli/src/commands.catalog.test.ts" "packages/biomeweaver-cli/src/options.test.ts" "packages/biomeweaver/src/baseline-guard.test.ts" "packages/calendar-engine/src/seasons.test.ts" "packages/capsule-source/src/diagnostics/diagnostic.test.ts" "packages/capsule-source/src/discovery/discover.test.ts" "packages/capsule-source/src/gather/fingerprint.test.ts" "packages/capsule-source/src/gather/gather.test.ts" "packages/capsule-source/src/json/parse-json.test.ts" "packages/capsule-source/src/yaml/parse-yaml.test.ts" "packages/fixed-point/src/arithmetic.test.ts" "packages/fixed-point/src/catalog.test.ts" "packages/fixed-point/src/coverage.test.ts" "packages/fixed-point/src/parse.test.ts" "packages/fixed-point/src/rounding.test.ts" "packages/flow-explanations/src/catalog.test.ts" "packages/flow-explanations/src/flow.test.ts" "packages/population-engine/src/cohorts.test.ts" "packages/population-engine/src/stages.test.ts" "packages/predation-engine/src/consume.test.ts" "packages/resource-engine/src/allocate.test.ts" "packages/resource-engine/src/renew.test.ts" "packages/run-store/src/store.test.ts" "packages/tick-runtime/src/advance.test.ts"
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
