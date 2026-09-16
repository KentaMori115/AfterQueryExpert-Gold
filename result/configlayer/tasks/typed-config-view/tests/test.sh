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
require_cmd() { command -v "$1" >/dev/null 2>&1 || { log "ERROR: missing $1"; exit 127; }; }
require_cmd python3
python3 -m pytest --version >/dev/null 2>&1 || { log "ERROR: pytest is unavailable"; exit 127; }

# Two fixed selections: the repository suite backs the pass-to-pass ids,
# the new tests back the fail-to-pass ids.  Explicit file lists mean a
# stray file under tests/ can never join or displace a graded run, and
# no fail-fast flag is ever passed, so every id reaches its report.
P2P_FILES="
tests/access/test_deep_delete.py
tests/access/test_deep_get.py
tests/access/test_deep_has.py
tests/access/test_deep_keys.py
tests/access/test_deep_pop.py
tests/access/test_deep_set.py
tests/access/test_deep_update.py
tests/access/test_flatten.py
tests/access/test_unflatten.py
tests/cache/test_cache.py
tests/cache/test_fingerprint.py
tests/cache/test_store.py
tests/contract/test_contract.py
tests/contract/test_report.py
tests/contract/test_violation.py
tests/diff/test_change.py
tests/diff/test_diff.py
tests/diff/test_format.py
tests/env/test_env_source.py
tests/env/test_parser.py
tests/interpolator/test_interpolator.py
tests/interpolator/test_resolver.py
tests/layers/test_config.py
tests/layers/test_layer.py
tests/layers/test_resolution.py
tests/layers/test_stack.py
tests/loader/test_base.py
tests/loader/test_env_loader.py
tests/loader/test_ini_loader.py
tests/loader/test_json_loader.py
tests/loader/test_registry.py
tests/loader/test_toml_loader.py
tests/merger/test_merged_accumulated.py
tests/merger/test_merger.py
tests/merger/test_provenance.py
tests/merger/test_strategy.py
tests/merger/test_subset.py
tests/policy/test_pattern.py
tests/policy/test_policy.py
tests/policy/test_report.py
tests/policy/test_rule.py
tests/schema/test_field.py
tests/schema/test_schema.py
tests/schema/test_validator.py
tests/secrets/test_redactor.py
tests/secrets/test_resolver.py
tests/source/test_base.py
tests/source/test_dict_source.py
tests/source/test_env_source.py
tests/source/test_file_source.py
tests/source/test_schema_env_source.py
tests/test_diffing.py
tests/test_package.py
tests/test_scenarios.py
tests/watcher/test_change.py
tests/watcher/test_listener.py
tests/watcher/test_watcher.py
"
F2P_FILES="
tests/typed/test_typed_parse.py
tests/typed/test_typed_view.py
"
set +e
run_log python3 -m pytest -p no:cacheprovider -o addopts= --noconftest -q \
  --junitxml=/logs/verifier/p2p.xml $P2P_FILES
log "existing-suite run exited $?"
run_log python3 -m pytest -p no:cacheprovider -o addopts= --noconftest -q \
  --junitxml=/logs/verifier/f2p.xml $F2P_FILES
log "new-test run exited $?"
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
