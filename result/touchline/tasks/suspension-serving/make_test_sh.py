#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

Only the bytes between the RUN TESTS markers are ours. Everything outside them
is asserted byte-identical to the frame the platform issued, so a careless edit
to the frame cannot ship.
"""
import sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
FRAME = HERE / "authoring" / "test.sh.frame"
OUT = HERE / "tests" / "test.sh"
START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"

BASE_SUITES = [
    "src/modules/audit/audit.routes.test.ts",
    "src/modules/auth/auth.routes.test.ts",
    "src/modules/clubs/club.routes.test.ts",
    "src/modules/discipline/discipline.routes.test.ts",
    "src/modules/divisions/division.routes.test.ts",
    "src/modules/fixtures/fixture.routes.test.ts",
    "src/modules/players/player.routes.test.ts",
    "src/modules/results/result.routes.test.ts",
    "src/modules/seasons/season.routes.test.ts",
    "src/modules/standings/standing.routes.test.ts",
    "src/modules/teams/team.routes.test.ts",
    "src/modules/venues/venue.routes.test.ts",
    "tests/health.test.ts",
]
# Shared by every suite, committed, and therefore a submission's to rewrite.
BASE_SUPPORT = ["tests/helpers.ts", "tests/setup.ts"]
NEW_SUITES = ["tests/ban-serving.test.ts", "tests/matchday-eligibility.test.ts"]

RESTORE = "\n".join(
    f"  git -C /app checkout HEAD -- {path} 2>/dev/null" for path in BASE_SUITES + BASE_SUPPORT
)
SUITE_LIST = ",\n        ".join(f'"<rootDir>/{s}"' for s in BASE_SUITES + NEW_SUITES)

BLOCK = r'''
# The image installs jest, ts-jest, typescript, express, zod and supertest
# into /opt/deps/node_modules and leaves /app without a node_modules of its
# own, so the real runner drives both selections from a tree the submission
# never touched. What the image does not provide is a report format the grader
# reads, and the repository's own jest.config.js, package.json, tsconfig.json
# and tests/setup.ts are all committed files a submission may rewrite. So
# configuration, reporter and integrity guard all live outside /app, the run
# happens as an unprivileged user, and the result stream is signed with a token
# the parent reads from stdin before any worker exists. A python3 publisher
# holding the whitelist turns that stream into the two reports config.json
# names, failing every id the stream did not carry.
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

    let lengthThrew = false
    try {
        snapshot.expect([1]).toHaveLength(2)
    } catch (err) {
        lengthThrew = true
    }
    if (!lengthThrew) {
        throw new Error("verifier: a failing length assertion did not fail")
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
// package.json, tsconfig.json and tests/setup.ts are all committed files, so a
// submission can rewrite them; none of them is read here. Every package,
// including the transformer and the test environment, is named by absolute
// path under /opt/deps, and module resolution for the repository's own
// imports of express, zod and supertest goes there too rather than anywhere
// under /app.
module.exports = {
    rootDir: "/app",
    roots: ["<rootDir>/src", "<rootDir>/tests"],
    testEnvironment: "/opt/deps/node_modules/jest-environment-node",
    testMatch: [
        __SUITES__,
    ],
    transform: {
        "^.+\\.ts$": [
            "/opt/deps/node_modules/ts-jest/dist/index.js",
            {
                // Transpile only. The graded suite must compile against
                // whatever shapes a submission chose, and a type error in one
                // file would otherwise take every case in it down with it.
                isolatedModules: true,
                diagnostics: false,
                tsconfig: {
                    target: "ES2022",
                    module: "commonjs",
                    moduleResolution: "node",
                    esModuleInterop: true,
                    isolatedModules: true,
                    skipLibCheck: true,
                    types: [],
                },
            },
        ],
    },
    modulePaths: ["/opt/deps/node_modules"],
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
            if status not in rank:
                status = "failed"
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

# A submission can edit the existing suites and the helpers they share, and
# those cases back the pass-to-pass ids, so put them back the way the base
# commit had them.
if command -v git >/dev/null 2>&1; then
  git -C /app config --global --add safe.directory /app 2>/dev/null
__RESTORE__
fi

# The generated config names the harness by absolute path; point it at
# wherever the harness actually landed.
sed -i "s#/verify/#$VERIFY_DIR/#g" "$VERIFY_DIR/jest.verifier.config.js" 2>/dev/null

chmod 0444 "$VERIFY_DIR"/*.js "$VERIFY_DIR"/publish.py 2>/dev/null

# One token per run, readable by root alone. The jest parent reads it from
# stdin and signs the stream with it; a worker inherits the descriptor at
# EOF and gets nothing.
TOKEN="$( (head -c 24 /dev/urandom | od -An -tx1 | tr -d " \n") 2>/dev/null )"
[ -n "$TOKEN" ] || TOKEN="fallback-$$-$(date +%s 2>/dev/null)"
printf "%s" "$TOKEN" > "$VERIFY_DIR/token"
chmod 0400 "$VERIFY_DIR/token" 2>/dev/null

# Resolution must not walk into anything the submission shipped. The image
# has no /app/node_modules, but a committed one (a symlink to /opt/deps is the
# obvious thing for a submission to leave behind) goes, so the image's own
# tree is the only one on the path.
rm -rf /app/node_modules 2>/dev/null

JEST_BIN=/opt/deps/node_modules/jest/bin/jest.js
[ -f "$JEST_BIN" ] || JEST_BIN="$(command -v jest 2>/dev/null)"

RUNNER=""
if command -v setpriv >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
  RUNNER="setpriv --reuid=65534 --regid=65534 --clear-groups"
  chown -R 65534:65534 "$VERIFY_DIR/scratch" 2>/dev/null
fi

if [ -n "$JEST_BIN" ] && command -v node >/dev/null 2>&1; then
  log "running the graded suites as ${RUNNER:-root}"
  printf "%s" "$TOKEN" | timeout 1200 env \
      HOME="$VERIFY_DIR/scratch" TMPDIR="$VERIFY_DIR/scratch" \
      LOG_LEVEL=silent DATABASE_FILE=":memory:" \
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
'''


def main():
    frame = FRAME.read_text()
    if START not in frame or END not in frame:
        sys.exit("frame markers missing")
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)
    block = BLOCK.replace("__SUITES__", SUITE_LIST).replace("__RESTORE__", RESTORE)
    assert "__SUITES__" not in block and "__RESTORE__" not in block
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + START + block + END + tail)

    made = OUT.read_text()
    mhead, mrest = made.split(START, 1)
    _, mtail = mrest.split(END, 1)
    assert mhead == head, "bytes above the marker moved"
    assert mtail == tail, "bytes below the marker moved"
    print(f"test.sh written, {len(made)} bytes; frame verified byte-identical "
          f"({len(head)} above, {len(tail)} below)")


if __name__ == "__main__":
    main()
