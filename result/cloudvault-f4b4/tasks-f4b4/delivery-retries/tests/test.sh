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
# The image installs jest, ts-jest and the native packages the existing
# suites need, so the real runner drives both selections. What it does not
# provide is a report format the grader reads, and the repository's own
# jest.config.js, package.json and tsconfig.json are all committed files a
# submission may rewrite. So configuration, reporter and integrity guard
# all live outside /app, the run happens as an unprivileged user, and the
# result stream is signed with a token the parent reads from stdin before
# any worker exists. A python3 publisher holding the whitelist turns that
# stream into the two reports config.json names, failing every id the
# stream did not carry.
set +e

VERIFY_DIR=/verify
mkdir -p "$VERIFY_DIR" 2>/dev/null || VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/verify)"
mkdir -p "$VERIFY_DIR" "$VERIFY_DIR/scratch" 2>/dev/null
chmod 0777 "$VERIFY_DIR/scratch" 2>/dev/null

cat > "$VERIFY_DIR/guard.js" <<'__GUARD__'
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
__GUARD__

cat > "$VERIFY_DIR/reporter.js" <<'__REPORTER__'
// Verifier reporter. Lives outside /app, runs in the jest parent process, and
// is the only thing that writes a result stream.
//
// The parent reads a per-run token from stdin before any worker starts, so the
// submitted code, which only ever runs inside a worker, cannot learn it: the
// descriptor is at EOF by the time a worker inherits it. Results are signed
// with that token, and the root-side publisher refuses anything it cannot
// verify. Forging the stream therefore needs the token, and overwriting the
// signed file after the fact only breaks the signature.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const OUT = process.env.VERIFY_RESULTS || "/verify/scratch/results.json"

function readToken() {
    try {
        return fs.readFileSync(0, "utf8").trim()
    } catch (err) {
        return ""
    }
}

function idOf(filePath, assertion) {
    const rel = path.relative("/app", filePath) || filePath
    const parts = (assertion.ancestorTitles || []).concat([assertion.title || ""])
    return `${rel} > ${parts.filter((p) => p !== "").join(" > ")}`
}

function statusOf(assertion) {
    const raw = String(assertion.status || "")
    if (raw === "passed") return "passed"
    if (raw === "pending" || raw === "skipped" || raw === "todo" || raw === "disabled") {
        return "skipped"
    }
    return "failed"
}

class VerifierReporter {
    constructor() {
        this.token = readToken()
        this.tests = []
        this.suiteErrors = []
    }

    onTestResult(_test, result) {
        for (const assertion of result.testResults || []) {
            const entry = { name: idOf(result.testFilePath, assertion), status: statusOf(assertion) }
            if (entry.status !== "passed") {
                entry.message = (assertion.failureMessages || []).join("\n").slice(0, 4000)
            }
            this.tests.push(entry)
        }
        if (result.testExecError || (result.failureMessage && !(result.testResults || []).length)) {
            const rel = path.relative("/app", result.testFilePath) || result.testFilePath
            this.suiteErrors.push({
                file: rel,
                message: String(result.failureMessage || result.testExecError.message || "").slice(0, 4000),
            })
        }
    }

    onRunComplete() {
        const body = { tests: this.tests, suiteErrors: this.suiteErrors }
        const payload = JSON.stringify(body)
        const signature = this.token
            ? crypto.createHmac("sha256", this.token).update(payload).digest("hex")
            : ""
        fs.mkdirSync(path.dirname(OUT), { recursive: true })
        fs.writeFileSync(OUT, JSON.stringify({ signature, payload }))
    }
}

module.exports = VerifierReporter
__REPORTER__

cat > "$VERIFY_DIR/jest.verifier.config.js" <<'__JESTCFG__'
// Verifier-owned jest configuration. The repository's own jest.config.js,
// package.json and tsconfig.json are all committed files, so a submission can
// rewrite them; none of them is read here. Module resolution deliberately
// points at the image's package tree rather than anything under /app.
module.exports = {
    rootDir: "/app",
    testEnvironment: "node",
    testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.tsx?$": [
            "/opt/task-node_modules/ts-jest/dist/index.js",
            {
                // Transpile only. The graded suite must compile against
                // whatever shapes a submission chose, and a type error in one
                // file would otherwise take every case in it down with it.
                isolatedModules: true,
                diagnostics: false,
                tsconfig: {
                    target: "ES2020",
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                    isolatedModules: true,
                    skipLibCheck: true,
                },
            },
        ],
    },
    moduleNameMapper: {
        "^@/(.*)$": "/app/$1",
        "^@lib/(.*)$": "/app/lib/$1",
    },
    modulePaths: ["/opt/task-node_modules"],
    setupFilesAfterEnv: ["/verify/guard.js"],
    reporters: [["/verify/reporter.js", {}]],
    testTimeout: 20000,
    cache: false,
    verbose: false,
}
__JESTCFG__

cat > "$VERIFY_DIR/publish.py" <<'__PUBLISH__'
#!/usr/bin/env python3
"""Turn the signed result stream into the two reports config.json names.

Runs as root, never imports anything the submission can reach, and publishes
every whitelisted id whatever happened: an id the stream did not carry is
published as failed, and a stream whose signature does not verify publishes
the whole whitelist as failed. An empty report directory would read as a
broken verifier rather than a failed submission.
"""
import hashlib
import hmac
import json
import os
import sys


def load_ids(config, key):
    out, seen = [], set()
    for raw in config.get(key, []):
        name = str(raw).strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def write_report(path, ids, results, reason):
    tests = []
    for name in ids:
        entry = results.get(name)
        if entry is None:
            tests.append({"name": name, "status": "failed", "message": reason})
        else:
            row = {"name": name, "status": entry[0]}
            if entry[1]:
                row["message"] = entry[1]
            tests.append(row)
    passed = sum(1 for t in tests if t["status"] == "passed")
    doc = {
        "reportFormat": "CTRF",
        "specVersion": "1.0.0",
        "results": {
            "tool": {"name": "jest"},
            "summary": {
                "tests": len(tests),
                "passed": passed,
                "failed": len(tests) - passed,
                "skipped": 0,
                "pending": 0,
                "other": 0,
            },
            "tests": tests,
        },
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(doc, fh, indent=2)


def main():
    config_path, token_path, results_path, base_out, new_out = sys.argv[1:6]
    with open(config_path) as fh:
        config = json.load(fh)
    p2p = load_ids(config, "p2p_node_ids")
    f2p = load_ids(config, "f2p_node_ids")

    results = {}
    reason = "missing from the run"

    try:
        with open(token_path) as fh:
            token = fh.read().strip()
        with open(results_path) as fh:
            stream = json.load(fh)
        payload = stream["payload"]
        expected = hmac.new(token.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(stream.get("signature", ""))):
            raise ValueError("signature mismatch")
        body = json.loads(payload)
        for row in body.get("tests", []):
            name = str(row.get("name", "")).strip()
            if not name:
                continue
            status = str(row.get("status", "failed"))
            message = str(row.get("message", ""))[:4000]
            prior = results.get(name)
            # worst status wins, so a duplicated id cannot be laundered into a pass
            rank = {"passed": 0, "skipped": 1, "failed": 2}
            if prior is None or rank[status] > rank[prior[0]]:
                results[name] = (status, message)
        for err in body.get("suiteErrors", []):
            print(f"[verifier] suite error in {err.get('file')}: {err.get('message')}")
    except Exception as exc:  # noqa: BLE001
        results = {}
        reason = f"result stream unusable: {exc}"
        print(f"[verifier] {reason}")

    write_report(base_out, p2p, results, reason)
    write_report(new_out, f2p, results, reason)

    declared = set(p2p) | set(f2p)
    extra = [name for name in results if name not in declared]
    print(f"[verifier] published p2p={len(p2p)} f2p={len(f2p)} "
          f"stream={len(results)} undeclared={len(extra)}")


if __name__ == "__main__":
    main()
__PUBLISH__

# A submission can edit the existing suites, and those cases back the
# pass-to-pass ids, so put them back the way the base commit had them.
if command -v git >/dev/null 2>&1; then
  git -C /app config --global --add safe.directory /app 2>/dev/null
  git -C /app checkout HEAD -- __tests__/api-key.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/file-utils.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/image-processor.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/share-manager.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/share-utils.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/stats.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/version-trash.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/webhook.test.ts 2>/dev/null
  git -C /app checkout HEAD -- __tests__/workspace-rbac.test.ts 2>/dev/null
fi

# The generated config names the harness by absolute path; point it at
# wherever the harness actually landed.
sed -i "s#/verify/#$VERIFY_DIR/#g" "$VERIFY_DIR/jest.verifier.config.js" 2>/dev/null

# Only the eleven graded files run. A suite the submission adds under
# __tests__ is neither run nor reported.
python3 - "$VERIFY_DIR/jest.verifier.config.js" <<'__SUITES__'
import sys
suites = [
    "__tests__/api-key.test.ts",
    "__tests__/file-utils.test.ts",
    "__tests__/image-processor.test.ts",
    "__tests__/share-manager.test.ts",
    "__tests__/share-utils.test.ts",
    "__tests__/stats.test.ts",
    "__tests__/version-trash.test.ts",
    "__tests__/webhook.test.ts",
    "__tests__/workspace-rbac.test.ts",
    "__tests__/delivery-sweep.test.ts",
    "__tests__/delivery-attempts.test.ts",
]
names = ",\n        ".join(f'"<rootDir>/{s}"' for s in suites)
path = sys.argv[1]
body = open(path).read()
body = body.replace('testMatch: ["<rootDir>/__tests__/**/*.test.ts"],',
                    f"testMatch: [\n        {names},\n    ],")
open(path, 'w').write(body)
__SUITES__

chmod 0444 "$VERIFY_DIR"/*.js "$VERIFY_DIR"/publish.py 2>/dev/null

# One token per run, readable by root alone. The jest parent reads it from
# stdin and signs the stream with it; a worker inherits the descriptor at
# EOF and gets nothing.
TOKEN="$( (head -c 24 /dev/urandom | od -An -tx1 | tr -d " \n") 2>/dev/null )"
[ -n "$TOKEN" ] || TOKEN="fallback-$$-$(date +%s 2>/dev/null)"
printf "%s" "$TOKEN" > "$VERIFY_DIR/token"
chmod 0400 "$VERIFY_DIR/token" 2>/dev/null

# Resolution must not walk into anything the submission shipped, so the
# in-tree copy of the package directory goes and the image's own tree is
# the only one on the path.
rm -rf /app/node_modules 2>/dev/null

JEST_BIN=/opt/task-node_modules/jest-cli/bin/jest.js
[ -f "$JEST_BIN" ] || JEST_BIN="$(command -v jest 2>/dev/null)"

RUNNER=""
if command -v setpriv >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  RUNNER="setpriv --reuid=65534 --regid=65534 --clear-groups"
  chown -R 65534:65534 "$VERIFY_DIR/scratch" 2>/dev/null
fi

if [ -n "$JEST_BIN" ] && command -v node >/dev/null 2>&1; then
  log "running the graded suites as ${RUNNER:-root}"
  printf "%s" "$TOKEN" | timeout 900 env \
      HOME="$VERIFY_DIR/scratch" TMPDIR="$VERIFY_DIR/scratch" \
      VERIFY_RESULTS="$VERIFY_DIR/scratch/results.json" \
      $RUNNER node "$JEST_BIN" \
      --config "$VERIFY_DIR/jest.verifier.config.js" --ci --colors=false \
      2>&1 | tee -a "$RUN_LOG"
else
  log "ERROR: no node or no jest in this image; every id will be published as failed"
fi

# Reports are written whatever happened above, so an id that never ran is
# a failed id rather than a missing file.
python3 -I "$VERIFY_DIR/publish.py" /tests/config.json "$VERIFY_DIR/token" \
    "$VERIFY_DIR/scratch/results.json" \
    /logs/verifier/base_ctrf.json /logs/verifier/new_ctrf.json 2>&1 | tee -a "$RUN_LOG"

rm -f "$VERIFY_DIR/token" 2>/dev/null
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
