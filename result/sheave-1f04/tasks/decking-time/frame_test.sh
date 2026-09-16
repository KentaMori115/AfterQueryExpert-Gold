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
# <<EDIT-ME>> Replace this block with your real test invocations, then
# delete this marker line. Run TWO selections — the existing suite (backs the
# pass-to-pass ids) and your new tests (the fail-to-pass ids) — and write one
# machine-readable report per selection at exactly the paths listed under
# "grade".reports in tests/config.json. A test missing from every report
# grades as failed, so never let a command abort the block early.
#
# jest/vitest (TypeScript): attach a CTRF reporter (grade format "ctrf", node_id "name") and
# move each report to its config.json path between selections:
#
#   set +e
#   rm -rf ctrf
#   npx jest tests/existing-area.test.ts --reporters=default --reporters=jest-ctrf-json-reporter 2>&1 | tee -a "$RUN_LOG"
#   mv ctrf/ctrf-report.json /logs/verifier/base_ctrf.json
#   rm -rf ctrf
#   npx jest tests/new-behavior.test.ts --reporters=default --reporters=jest-ctrf-json-reporter 2>&1 | tee -a "$RUN_LOG"
#   mv ctrf/ctrf-report.json /logs/verifier/new_ctrf.json
#   set -e
#
# vitest equivalent: --reporter=default --reporter=ctrf-json with
# --outputFile pointed straight at the /logs/verifier/ report path.
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
