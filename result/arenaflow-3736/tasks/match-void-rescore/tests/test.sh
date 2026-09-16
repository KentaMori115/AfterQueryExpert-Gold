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
set +e
mkdir -p /logs/verifier

# Both selections run under runner configurations written here rather than any
# read out of /app, so a committed vitest config, alias or setup file cannot
# decide what a case reports. Plain objects, no imports: the project resolves
# from /app, which is where the runner is installed.

# The shipped cases are the pass-to-pass evidence, and the submission owns the
# tree they live in: a build that breaks one of them can simply rewrite the
# case, and the report comes back clean. Put every test file the base commit
# carries back the way it was, after the patches have been applied. Files the
# submission added on top are left alone, so its own tests still run.
base_commit=$(python3 -c 'import json;print(json.load(open("/tests/config.json")).get("base_commit") or "")' 2>/dev/null)
if [ -n "$base_commit" ] && command -v git >/dev/null 2>&1 \
   && git -C /app cat-file -e "${base_commit}^{commit}" 2>/dev/null; then
  if git -C /app checkout "$base_commit" -- tests >>"$RUN_LOG" 2>&1; then
    log "restored $(git -C /app ls-tree -r --name-only "$base_commit" -- tests | wc -l) shipped test files from $base_commit"
    log "note: only files the base commit carries come back; a test file added later is not restorable"
  else
    log "WARNING: shipped test files could not be restored, they run as submitted"
  fi
else
  log "WARNING: no usable base commit or no git, shipped test files run as submitted"
fi

# A canary the runner has to report as failed. Submitted code shares the
# process with the runner and can neuter an assertion, stub the runner, or
# hand back a report nobody ran; a case that cannot pass and comes back
# passing, or missing, says the report is fiction.
mkdir -p /app/.verifier-canary
cat > /app/.verifier-canary/canary.test.ts <<'CANARY'
import { describe, expect, it } from "vitest";

describe("verifier canary", () => {
  it("never passes", () => {
    expect(1).toBe(2);
  });
});
CANARY

GRADED_CONFIG=/tmp/arenaflow-graded.config.ts
cat > "$GRADED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    sequence: { shuffle: false },
    include: [
      '.verifier-canary/canary.test.ts',
      'tests/engine/withdrawn-results.test.ts',
      'tests/events/withdrawn-replay.test.ts',
    ],
  },
}
CONFIG

SHIPPED_CONFIG=/tmp/arenaflow-shipped.config.ts
cat > "$SHIPPED_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    sequence: { shuffle: false },
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/engine/withdrawn-results.test.ts',
      'tests/events/withdrawn-replay.test.ts',
    ],
  },
}
CONFIG

graded_status=1
if command -v npx >/dev/null 2>&1; then
  log "running the withdrawal cases"
  run_log npx vitest run --config "$GRADED_CONFIG" \
    --reporter=default --reporter=junit --outputFile.junit=/logs/verifier/new_junit.xml
  graded_status=$?
  log "withdrawal cases exited $graded_status"

  log "running the shipped suite"
  run_log npx vitest run --config "$SHIPPED_CONFIG" \
    --reporter=default --reporter=junit --outputFile.junit=/logs/verifier/base_junit.xml
  log "shipped suite exited $?"
else
  log "ERROR: npx is not on PATH, no case can run"
fi

# A run that ends badly while its report shows nothing wrong is a report that
# cannot be trusted: code under /app shares the process with the runner and can
# break it from the inside, leaving every case looking green. Publish every
# graded case as failed rather than read a report like that, and say why.
python3 - "$graded_status" <<'GUARD'
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.sax.saxutils import escape

status = int(sys.argv[1] or 0)
report = Path("/logs/verifier/new_junit.xml")
ids = json.loads(Path("/tests/config.json").read_text()).get("f2p_node_ids", [])

reason = None
if not report.exists() or report.stat().st_size == 0:
    reason = "no report was written"
else:
    try:
        tree = ET.parse(report)
    except ET.ParseError as err:
        reason = f"report will not parse ({err})"
    else:
        cases = list(tree.iter("testcase"))
        bad = [c for c in cases if list(c.iter("failure")) or list(c.iter("error"))]
        canary = [c for c in cases if (c.get("name") or "").strip() == "verifier canary > never passes"]
        if not cases:
            reason = "report carries no cases"
        elif not canary:
            reason = "the canary case never reported"
        elif not any(list(c.iter("failure")) or list(c.iter("error")) for c in canary):
            reason = "the canary case came back passing"
        elif status != 0 and not bad:
            reason = f"run exited {status} with nothing marked failed"

if reason is None:
    sys.exit(0)

print(f"[verifier] graded report rejected: {reason}")
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="withdrawals" tests="{len(ids)}">']
for node in ids:
    head, sep, name = node.partition(".test.ts.")
    classname = head + ".test.ts" if sep else head
    body.append(f'  <testcase classname="{escape(classname)}" name="{escape(name or node)}">')
    body.append(f'    <failure message="{escape(reason)}"></failure>')
    body.append("  </testcase>")
body.append("</testsuites>")
report.write_text("\n".join(body) + "\n")
GUARD
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
