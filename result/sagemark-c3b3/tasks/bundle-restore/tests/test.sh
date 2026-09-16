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

# The graded selection runs under a runner configuration written here rather
# than one read out of /app, so a committed config or setup file cannot decide
# what a case reports. Plain object, no imports: a config outside the project
# cannot resolve the project's own packages.
VERIFY_CONFIG=/tmp/sagemark-verify.config.ts
cat > "$VERIFY_CONFIG" <<'CONFIG'
export default {
  root: '/app',
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: [],
    include: [
      'src/core/io/restore-graph.spec.ts',
      'src/core/io/restore-tally.spec.ts',
      'src/core/io/restore-modules.spec.ts',
    ],
  },
}
CONFIG

log "running the restore cases"
run_log npx vitest run --config "$VERIFY_CONFIG" \
  --reporter=basic --reporter=junit --outputFile.junit=/logs/verifier/new_junit.xml
graded_status=$?
log "restore cases exited $graded_status"

log "running the rest of the suite"
run_log npx vitest run \
  --pool=forks --reporter=basic --reporter=junit \
  --outputFile.junit=/logs/verifier/base_junit.xml
log "rest of the suite exited $?"

# A run that ends badly while its report shows nothing wrong is a report that
# cannot be trusted: code under /app can break the runner from inside the
# process and leave every case looking green. Publish every graded case as
# failed rather than read a report like that, and say so in the log.
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
        if status != 0 and not bad:
            reason = f"run exited {status} with nothing marked failed"
        elif not cases:
            reason = "report carries no cases"

if reason is None:
    sys.exit(0)

print(f"[verifier] graded report rejected: {reason}")
body = ['<?xml version="1.0" encoding="UTF-8" ?>', f'<testsuites name="restore" tests="{len(ids)}">']
for node in ids:
    head, sep, name = node.partition(".spec.ts.")
    classname = head + ".spec.ts" if sep else head
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
