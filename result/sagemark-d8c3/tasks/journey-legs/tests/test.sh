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
BASE=00800e20bf11764d07d33a49ffd1f1798ed699ed
ADDED="src/core/rules/journey.spec.ts src/core/rules/supply.spec.ts"
BASE_REPORT=/logs/verifier/base_junit.xml
NEW_REPORT=/logs/verifier/new_junit.xml
MODEL_PATCH=/logs/artifacts/model.patch

# Specs sit beside the source in this repository, so the selection that backs
# the pass-to-pass ids is every spec the base tree carries, read from the base
# commit rather than from the submitted tree.
EXISTING="$(git ls-tree -r --name-only "$BASE" 2>/dev/null | grep '\.spec\.ts$' | tr '\n' ' ')"

# The suite imports the submitted src/ before a single case runs, so how the
# tests are found, loaded and asserted has to come from the repository and not
# from the change: every shipped spec, the vite, vitest and TypeScript
# configuration, the setup file the runner loads, and the package manifest are
# restored from the base commit. The held-back specs are new at the base, so
# the checkout leaves them alone.
git checkout -q "$BASE" -- '*.spec.ts' vitest.config.ts vite.config.ts src/test-setup.ts \
  package.json package-lock.json tsconfig.json tsconfig.app.json tsconfig.node.json \
  postcss.config.cjs tailwind.config.ts eslint.config.js .prettierrc.json index.html 2>/dev/null || \
  log "WARNING: could not restore the shipped specs and configuration from $BASE"
rm -rf dist coverage .vite node_modules/.vite node_modules/.vitest

# Dependencies are the image's. A patch that ships its own copy of a package, a
# workspace file that would redefine the run, the runner's setup file or an npm
# config that injects node options is not a submission the suite can be trusted
# on: both reports stay empty, so every declared id grades as failed with the
# reason in this log.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH"); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|vitest.workspace.*|vite.config.*|vitest.config.*|src/test-setup.*)
        refused="$refused $_p" ;;
    esac
  done
fi

report() {
  # default reporter to stdout so a failure stays readable, junit to the graded
  # report; written to a private path first so nothing left running under /app
  # can find the report by name before grading reads it.
  local target="$1" files="$2" tmp
  tmp="$(mktemp /tmp/junit.XXXXXXXX)"
  run_log node node_modules/vitest/vitest.mjs run --config ./vitest.config.ts \
    --pool=forks --reporter=default --reporter=junit --outputFile="$tmp" $files
  pkill -9 -x node 2>/dev/null || true
  mv -f "$tmp" "$target" 2>/dev/null || : > "$target"
}

if [ -n "$refused" ]; then
  log "ERROR: model.patch touches$refused; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
elif [ -z "$EXISTING" ]; then
  log "ERROR: no specs found at $BASE; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
elif [ ! -f node_modules/vitest/vitest.mjs ]; then
  log "ERROR: node_modules/vitest is missing from the image; every declared id will report failed"
  : > "$BASE_REPORT"
  : > "$NEW_REPORT"
else
  report "$BASE_REPORT" "$EXISTING"
  report "$NEW_REPORT" "$ADDED"
fi
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
