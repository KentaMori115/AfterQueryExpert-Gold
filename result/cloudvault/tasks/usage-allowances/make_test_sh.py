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

BLOCK = r'''
# Two selections, each producing one CTRF report at the path config.json names.
#
# jest-ctrf-json-reporter is NOT in this image's pinned dependency set and both
# containers run with allow_internet=false, so the report is built here rather
# than by a reporter package. jest's own reporter API needs no package.
#
# Integrity. Graded cases come from test.patch, applied after the submitted
# patch with its paths reset, so the suite file is ours. jest, its config and
# the reporter all live outside /app and cannot be shadowed by a committed
# file. The reporter runs in jest's MAIN process, which never loads repository
# code, and it reads a per-run token from stdin before any suite starts; every
# verdict line carries that token. Worker processes, where repository code does
# run, never see the token, so a forged line is rejected by the publisher. A
# setup file frozen into place stops a module neutering expect. The publisher
# holds the whitelist and publishes EVERY declared id, failing any the stream
# did not carry exactly once, so a crashed or silenced run reports failures
# rather than nothing.
#
# Every hardening step degrades. If setpriv, python3 or a writable scratch is
# missing, the block runs the next best way and still publishes a report; it
# never exits early and never leaves /logs/verifier empty.
set +e

HARNESS=""
for _cand in /run/aqh /tmp/aqh "$PWD/.aqh"; do
  mkdir -p "$_cand" 2>/dev/null && HARNESS="$_cand" && break
done
[ -n "$HARNESS" ] || HARNESS=/tmp
log "harness dir $HARNESS"

SCRATCH="$HARNESS/scratch"
mkdir -p "$SCRATCH" 2>/dev/null
chmod 0777 "$SCRATCH" 2>/dev/null

cat > "$HARNESS/jest.config.js" <<'AQCFG'
// Built here, not read from /app, so a committed jest.config.js cannot change
// how the graded suites are transformed or which files are collected.
module.exports = {
    rootDir: "/app",
    roots: ["/app"],
    testEnvironment: "node",
    testMatch: ["**/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.ts$": ["ts-jest", {
            tsconfig: {
                target: "ES2020", module: "commonjs", moduleResolution: "node",
                esModuleInterop: true, isolatedModules: true, skipLibCheck: true,
            },
        }],
    },
    moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1", "^@lib/(.*)$": "<rootDir>/lib/$1" },
    cacheDirectory: process.env.AQ_CACHE || "/tmp/aq-jest-cache",
    testEnvironmentOptions: {},
}
AQCFG

cat > "$HARNESS/freeze.js" <<'AQFRZ'
// Runs in the worker before any suite file is imported, so it captures the
// framework's decision points ahead of repository code and pins them down.
// A module that later assigns a quieter expect or a no-op matcher cannot take
// effect, and a case that ends up asserting nothing is not credited.
const pin = (name) => {
    const value = globalThis[name]
    if (typeof value === "undefined") return
    try {
        Object.defineProperty(globalThis, name, {
            value, writable: false, configurable: false, enumerable: true,
        })
    } catch (e) { /* already pinned */ }
}
for (const name of ["expect", "describe", "it", "test", "beforeAll", "beforeEach", "afterEach", "afterAll"]) {
    pin(name)
}
if (typeof expect === "function" && expect.getState) {
    const realExpect = expect
    beforeEach(() => { realExpect.setState({ ...realExpect.getState(), assertionCalls: 0 }) })
    afterEach(() => {
        const calls = realExpect.getState().assertionCalls
        if (!calls) throw new Error("graded case asserted nothing")
    })
}
AQFRZ

cat > "$HARNESS/reporter.js" <<'AQREP'
// jest reporter, main process only. Repository code is never imported here.
const fs = require("fs")
const writeSync = fs.writeSync            // captured before anything can swap it
const openSync = fs.openSync
let TOKEN = ""
try { TOKEN = fs.readFileSync(0, "utf8").trim() } catch (e) { TOKEN = "" }

class AQReporter {
    constructor(globalConfig, options) { this.out = (options && options.stream) || process.env.AQ_STREAM }
    onRunComplete(contexts, results) {
        const lines = []
        let count = 0
        for (const suite of results.testResults || []) {
            for (const t of suite.testResults || []) {
                const name = String(t.fullName || "").replace(/[\r\n]+/g, " ").trim()
                if (!name) continue
                const ok = t.status === "passed" ? "pass" : "fail"
                lines.push("V " + TOKEN + " " + ok + " " + name)
                count += 1
            }
            if (suite.testExecError && (suite.testResults || []).length === 0) {
                lines.push("S " + TOKEN + " " + String(suite.testFilePath || "").replace(/[\r\n]+/g, " "))
            }
        }
        lines.push("END " + TOKEN + " " + count)
        try {
            const fd = openSync(this.out, "a")
            writeSync(fd, lines.join("\n") + "\n")
        } catch (e) { /* publisher will fail every declared id */ }
    }
}
module.exports = AQReporter
AQREP

cat > "$HARNESS/publish.py" <<'AQPUB'
#!/usr/bin/env python3
"""Verdict stream -> one CTRF report. Publishes every declared id, always."""
import json, sys, collections

stream_path, token, out_path, which, cfg_path = sys.argv[1:6]
cfg = json.loads(open(cfg_path).read())
declared = [str(x).strip() for x in cfg.get(which, []) if str(x).strip()]

seen, forged, ended, claimed = collections.OrderedDict(), 0, False, -1
try:
    raw = open(stream_path, encoding="utf-8", errors="replace").read().splitlines()
except OSError:
    raw = []
for line in raw:
    parts = line.split(" ", 3)
    if len(parts) >= 3 and parts[0] == "V":
        if parts[1] != token:
            forged += 1
            continue
        status, name = parts[2], (parts[3] if len(parts) > 3 else "").strip()
        if not name:
            continue
        # claim-once: a name arriving twice is not credited twice
        if name in seen:
            seen[name] = "failed"
        else:
            seen[name] = "passed" if status == "pass" else "failed"
    elif len(parts) >= 3 and parts[0] == "END":
        if parts[1] == token:
            ended, claimed = True, int(parts[2]) if parts[2].isdigit() else -1

honest = ended and claimed == len(seen) and forged == 0
if not honest:
    sys.stderr.write(
        "[publish] stream not trustworthy: ended=%s claimed=%s seen=%d forged=%d\n"
        % (ended, claimed, len(seen), forged))

tests = []
passed = failed = 0
for nid in declared:
    status = seen.get(nid, "failed") if honest else "failed"
    if status == "passed":
        passed += 1
    else:
        failed += 1
    row = {"name": nid, "status": status}
    if status != "passed":
        row["message"] = ("did not report a passing verdict on a trusted stream"
                          if not honest else "reported failed or never reported")
    tests.append(row)

doc = {"reportFormat": "CTRF", "specVersion": "1.0.0", "results": {
    "tool": {"name": "jest"},
    "summary": {"tests": len(tests), "passed": passed, "failed": failed,
                "skipped": 0, "pending": 0, "other": 0},
    "tests": tests}}
with open(out_path, "w") as fh:
    json.dump(doc, fh, indent=2)
print("[publish] %s -> %d declared, %d passed, %d failed (honest=%s)"
      % (which, len(tests), passed, failed, honest))
AQPUB

chmod 0644 "$HARNESS"/jest.config.js "$HARNESS"/freeze.js "$HARNESS"/reporter.js "$HARNESS"/publish.py 2>/dev/null

AQ_RUNNER=""
if command -v setpriv >/dev/null 2>&1 && [ "$(id -u)" = "0" ] && id nobody >/dev/null 2>&1; then
  AQ_RUNNER="setpriv --reuid=nobody --regid=nogroup --clear-groups"
  log "running suites as nobody"
else
  log "setpriv or root unavailable; running suites in place"
fi

run_selection() {
  _label="$1"; _out="$2"; _which="$3"; shift 3
  _stream="$SCRATCH/${_label}.stream"
  _token="$(head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  [ -n "$_token" ] || _token="fallback-$$-${_label}"
  : > "$_stream" 2>/dev/null
  chmod 0666 "$_stream" 2>/dev/null
  export AQ_STREAM="$_stream"
  export AQ_CACHE="$SCRATCH/cache-${_label}"
  mkdir -p "$AQ_CACHE" 2>/dev/null; chmod 0777 "$AQ_CACHE" 2>/dev/null
  echo "+ jest selection ${_label}: $*" >> "$RUN_LOG" 2>/dev/null
  printf '%s' "$_token" | env HOME="$SCRATCH" $AQ_RUNNER \
    node /app/node_modules/jest/bin/jest.js \
      --config "$HARNESS/jest.config.js" \
      --setupFilesAfterEnv "$HARNESS/freeze.js" \
      --reporters=default --reporters="$HARNESS/reporter.js" \
      --ci --runTestsByPath "$@" 2>&1 | tee -a "$RUN_LOG"
  python3 "$HARNESS/publish.py" "$_stream" "$_token" "$_out" "$_which" /tests/config.json 2>&1 | tee -a "$RUN_LOG"
}

run_selection base /logs/verifier/base_ctrf.json p2p_node_ids \
  /app/__tests__/api-key.test.ts /app/__tests__/file-utils.test.ts \
  /app/__tests__/image-processor.test.ts /app/__tests__/share-manager.test.ts \
  /app/__tests__/share-utils.test.ts /app/__tests__/stats.test.ts \
  /app/__tests__/version-trash.test.ts /app/__tests__/webhook.test.ts \
  /app/__tests__/workspace-rbac.test.ts

run_selection new /logs/verifier/new_ctrf.json f2p_node_ids \
  /app/__tests__/metering-fold.test.ts /app/__tests__/plan-balances.test.ts

set -e
'''

def main():
    frame = FRAME.read_text()
    if START not in frame or END not in frame:
        sys.exit("frame markers missing")
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + START + BLOCK + END + tail)

    # the frame outside the markers must be byte-identical to what was issued
    made = OUT.read_text()
    mhead, mrest = made.split(START, 1)
    _, mtail = mrest.split(END, 1)
    assert mhead == head, "bytes above the marker moved"
    assert mtail == tail, "bytes below the marker moved"
    print(f"test.sh written, {len(made)} bytes; frame verified byte-identical "
          f"({len(head)} above, {len(tail)} below)")

if __name__ == "__main__":
    main()
