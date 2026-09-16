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
BASE=cbfb245b02c044e160ca8346fc17ce78eb374ddc
EXISTING="tests/catalog/calibre.test.ts tests/catalog/effect.test.ts \
tests/catalog/envelope.test.ts tests/catalog/hazard.test.ts \
tests/catalog/inventory.test.ts tests/catalog/lift.test.ts \
tests/catalog/magazine.test.ts tests/catalog/palette.test.ts \
tests/catalog/parse.test.ts tests/catalog/registry.test.ts \
tests/catalog/substitute.test.ts tests/catalog/timing.test.ts \
tests/catalog/validate.test.ts tests/cli/args.test.ts \
tests/cli/commands.test.ts tests/cli/command.test.ts \
tests/cli/completion.test.ts tests/cli/diffHazard.test.ts \
tests/cli/distance.test.ts tests/cli/label.test.ts tests/cli/lint.test.ts \
tests/cli/permitContinuity.test.ts tests/cli/planLayout.test.ts \
tests/cli/preview.test.ts tests/cli/sheetInventory.test.ts \
tests/compile.test.ts tests/core/codes.test.ts tests/core/collect.test.ts \
tests/core/csv.test.ts tests/core/diagnostic.test.ts tests/core/graph.test.ts \
tests/core/ids.test.ts tests/core/interval.test.ts tests/core/numeric.test.ts \
tests/core/result.test.ts tests/core/rng.test.ts tests/core/span.test.ts \
tests/core/text.test.ts tests/core/timecode.test.ts tests/core/units.test.ts \
tests/coverage.test.ts tests/endToEnd.test.ts tests/examples.test.ts \
tests/export/explain.test.ts tests/export/firingTable.test.ts \
tests/export/json.test.ts tests/export/pack.test.ts \
tests/export/permit.test.ts tests/export/sheets.test.ts \
tests/export/siteplan.test.ts tests/large.test.ts tests/rig/allocate.test.ts \
tests/rig/circuit.test.ts tests/rig/continuity.test.ts \
tests/rig/layout.test.ts tests/rig/module.test.ts tests/rig/parse.test.ts \
tests/rig/pin.test.ts tests/rig/redundancy.test.ts tests/rig/rig.test.ts \
tests/rig/wiring.test.ts tests/robust.test.ts tests/safety/crowd.test.ts \
tests/safety/distance.test.ts tests/safety/noise.test.ts \
tests/safety/rules.test.ts tests/safety/site.test.ts \
tests/safety/wind.test.ts tests/script/annotate.test.ts \
tests/script/ast.test.ts tests/script/expand.test.ts \
tests/script/format.test.ts tests/script/include.test.ts \
tests/script/lint.test.ts tests/script/parser.test.ts \
tests/script/renumber.test.ts tests/script/resolve.test.ts \
tests/script/token.test.ts tests/sim/preview.test.ts \
tests/sim/trajectory.test.ts tests/surface.test.ts \
tests/timeline/balance.test.ts tests/timeline/chain.test.ts \
tests/timeline/density.test.ts tests/timeline/diff.test.ts \
tests/timeline/load.test.ts tests/timeline/misfire.test.ts \
tests/timeline/quantise.test.ts tests/timeline/rehearsal.test.ts \
tests/timeline/schedule.test.ts tests/timeline/sync.test.ts \
tests/version.test.ts"
ADDED="tests/timeline/panelClock.test.ts tests/cli/morningAfter.test.ts"
BASE_REPORT=/logs/verifier/base_junit.xml
NEW_REPORT=/logs/verifier/new_junit.xml
MODEL_PATCH=/logs/artifacts/model.patch

# The suite imports the submitted src/ before a single case runs, so how the
# tests are found, loaded and asserted must come from the repository, not
# from the change: the whole test tree, the vitest, TypeScript, eslint and
# prettier configuration and the package manifest are restored from the base
# commit. The held-back files are new at the base, so the checkout leaves
# them be.
git checkout -q "$BASE" -- tests vitest.config.ts package.json package-lock.json \
  tsconfig.json tsconfig.build.json tsconfig.bench.json eslint.config.js \
  .prettierrc.json .prettierignore 2>/dev/null || \
  log "WARNING: could not restore the test tree and configuration from $BASE"
rm -rf dist dist-bench coverage

# Dependencies are the image's. A patch that ships its own copy of a package,
# a workspace file that would redefine the test run, a setup file under the
# test tree, or an npm config that injects node options is not a submission
# the suite can be trusted on: both reports stay empty, so every declared id
# grades as failed with the reason in this log.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH"); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|vitest.workspace.*|vite.config.*|vitest.config.*|tests/setup*|tests/support/*)
        refused="$refused $_p" ;;
    esac
  done
fi

report() {
  # default reporter to stdout so failures stay readable, junit to the graded
  # report; written to a private path first so nothing left running under
  # /app can find the report by name before grading reads it.
  local target="$1" files="$2" tmp
  tmp="$(mktemp /tmp/junit.XXXXXXXX)"
  run_log node node_modules/vitest/vitest.mjs run --config ./vitest.config.ts \
    --reporter=default --reporter=junit --outputFile="$tmp" $files
  pkill -9 -x node 2>/dev/null || true
  mv -f "$tmp" "$target" 2>/dev/null || : > "$target"
}

if [ -n "$refused" ]; then
  log "ERROR: model.patch touches$refused; every declared id will report failed"
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
