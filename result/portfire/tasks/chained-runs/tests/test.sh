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
# Two vitest selections: the repository's own suite (pass-to-pass) and the
# held-back tests (fail-to-pass). Both import the submitted src/ before a
# single case runs, so everything that decides what a case is and how it is
# judged is the repository's, not the change's: the whole test tree and the
# tooling configuration are restored from the base commit, the vitest that
# runs is the image's own, and the run is refused outright when the patch
# ships packages, an npm config or a workspace file. The vitest child runs
# as an unprivileged user, so nothing it imports from /app can write to
# /app, /tests, the kept copies or the reports. Between the two suites every
# held-back file is put back from a root-only copy and digest-checked, so
# code that ran during the first suite cannot leave a rewritten module for
# the second, and no process started by a suite survives into grading.
BASE=cbfb245b02c044e160ca8346fc17ce78eb374ddc
NEW_FILES="tests/support/frozenExpect.ts tests/script/quickmatchRuns.test.ts tests/timeline/oneOutput.test.ts"
NEW_RUN="tests/script/quickmatchRuns.test.ts tests/timeline/oneOutput.test.ts"
BASE_REPORT=/logs/verifier/base.xml
NEW_REPORT=/logs/verifier/new.xml
MODEL_PATCH=/logs/artifacts/model.patch

unset NODE_OPTIONS NODE_PATH VITEST VITEST_MODE
export NODE_ENV=test
export CI=true

# Only root reads the verifier's own directory from here on. Knowing which
# ids are graded is the difference between forging a report and reproducing
# a whole run, and nothing the suites do needs that list.
chmod -R go-rwx /tests 2>/dev/null || true

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
KEEP="$VDIR/keep"
SUITE_TMP="$VDIR/tmp"
mkdir -p "$RPTDIR" "$KEEP" "$SUITE_TMP" 2>/dev/null || true
chmod 1777 "$SUITE_TMP" 2>/dev/null || true

# The tests, the configuration that finds and transpiles them, and the
# package manifest come back from the base commit. The held-back files are
# new at the base, so the checkout leaves them alone.
git -C /app checkout -q "$BASE" -- tests vitest.config.ts tsconfig.json \
  tsconfig.build.json tsconfig.bench.json package.json package-lock.json \
  eslint.config.js .prettierrc.json 2>/dev/null || \
  log "WARNING: could not restore the test tree and configuration from $BASE"
rm -rf /app/dist /app/dist-bench /app/coverage 2>/dev/null || true
find /app/tests -name '*.test.ts' -newer /app/package.json 2>/dev/null | head -0

# Dependencies are the image's. A patch that ships its own copy of a
# package, a workspace file vitest would pick up beside any configuration,
# or an npm config is not a submission the suites can be trusted on: both
# reports publish every declared id as failed, with the reason in this log.
# The repository's own vitest configuration is never read, so editing it is
# neither refused nor honoured.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH" 2>/dev/null); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|.yarnrc*|.pnpmfile*|vitest.workspace.*)
        refused="$refused $_p" ;;
    esac
  done
fi

# Drop privileges for the vitest child. Submitted code executes inside it,
# so it must not be able to reach the verifier's files, the reports, or the
# checkout it is graded against. Without setpriv the suites run as the
# current user and the log says so; the block degrades, it never refuses.
RUNAS=""
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  RUN_UID=$(id -u nobody 2>/dev/null || echo 65534)
  RUN_GID=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)
  if setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups true >/dev/null 2>&1; then
    RUNAS="setpriv --reuid=$RUN_UID --regid=$RUN_GID --clear-groups"
    log "vitest child runs as uid $RUN_UID gid $RUN_GID"
  fi
fi
[ -n "$RUNAS" ] || log "no setpriv; the suites run as $(id -un)"

# The digests live in this shell's memory, not in a file anything else can
# reach.
NEW_SHA=$(cat <<'SHA_NEW'
6392ea0a78c541e9c783a64658edc8e0fc464c22a104de3692752f1924320ae4  tests/support/frozenExpect.ts
bb456ca76ee3934e48e9e2454b4289138fb7c0ddec7ccb7602010c3928444863  tests/script/quickmatchRuns.test.ts
ca81b6670b2d788b7ed4e7435be9631f31ef058369b8a739e0d8a3e5a5fbe9be  tests/timeline/oneOutput.test.ts
SHA_NEW
)
new_matches() { printf '%s\n' "$NEW_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
log_mismatch() { printf '%s\n' "$NEW_SHA" | (cd /app && sha256sum -c - 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true; }

NEW_OK=1
if new_matches; then
  for f in $NEW_FILES; do
    mkdir -p "$KEEP/$(dirname "$f")" 2>/dev/null || true
    cp "/app/$f" "$KEEP/$f" 2>/dev/null || true
  done
else
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
  log_mismatch
fi
chmod -R go-rwx "$KEEP" 2>/dev/null || true
chmod 0700 "$RPTDIR" "$KEEP" 2>/dev/null || true
chmod 0555 "$VDIR" 2>/dev/null || true

# The unprivileged child needs to read the tree and vitest needs a cache
# directory it can write; that directory is the one place under /app it may
# write, and nothing graded is read from it. The configuration is read from
# a file the block writes itself in the scratch directory, because vite
# bundles a configuration to a temporary file beside it and /app is not the
# child's to write; it names what the repository's own configuration names
# and nothing a submission could add to it, fresh before each suite.
chmod -R a+rX /app 2>/dev/null || true
mkdir -p /app/node_modules/.vite /app/node_modules/.vitest 2>/dev/null || true
chmod -R a+rwX /app/node_modules/.vite /app/node_modules/.vitest 2>/dev/null || true
fresh_config() {
  rm -f "$SUITE_TMP"/vitest.config.mjs "$SUITE_TMP"/vitest.config.mjs.timestamp-* 2>/dev/null || true
  cat > "$SUITE_TMP/vitest.config.mjs" <<'VCFG'
export default {
  test: {
    root: "/app",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    isolate: true,
    watch: false,
  },
};
VCFG
  chmod 0644 "$SUITE_TMP/vitest.config.mjs" 2>/dev/null || true
}

# Process snapshot before the suites, for the sweeps.
proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
sweep() {
  for _pid in $(proc_list); do
    echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
    case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
    kill -9 "$_pid" 2>/dev/null || true
  done
}

# Every declared id for a report, so a refused or aborted run still
# publishes each of them as failed and the report is never empty.
publish_failed() {
  python3 - "$1" "$2" "$3" <<'PYFAIL'
import json, sys, xml.sax.saxutils as X
target, key, reason = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    ids = json.load(open("/tests/config.json")).get(key, [])
except Exception:
    ids = []
rows = []
for joined in ids:
    cls, _, name = joined.rpartition(".")
    rows.append('<testcase classname=%s name=%s><failure message=%s/></testcase>'
                % (X.quoteattr(cls), X.quoteattr(name), X.quoteattr(reason)))
open(target, "w").write('<?xml version="1.0" encoding="utf-8"?><testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
print("[publish] %s: %d declared ids published as failed (%s)" % (target, len(rows), reason))
PYFAIL
}

# One vitest run, junit written to a private path and moved into the
# root-only report directory only after the child has exited and the
# sweep has run. Ids the run never reported are added as failed by a
# second pass so the report is complete whatever happened.
run_suite() {
  _target="$1"; _key="$2"; shift 2
  _tmp="$SUITE_TMP/junit.$$.$RANDOM.xml"
  echo "+ vitest -> $_target ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  fresh_config
  ( cd /app && \
    setsid timeout 1500 $RUNAS env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$SUITE_TMP" TMPDIR="$SUITE_TMP" \
      NODE_ENV=test CI=true \
      node node_modules/vitest/vitest.mjs run --root /app --config "$SUITE_TMP/vitest.config.mjs" \
      --reporter=default --reporter=junit --outputFile="$_tmp" "$@" ) >> "$RUN_LOG" 2>&1
  _rc=$?
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
  sweep
  python3 - "$_tmp" "$_target" "$_key" <<'PYCOMPLETE'
import json, os, sys, xml.etree.ElementTree as ET, xml.sax.saxutils as X
src, target, key = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    ids = json.load(open("/tests/config.json")).get(key, [])
except Exception:
    ids = []
seen = {}
order = []
try:
    root = ET.parse(src).getroot()
    for case in root.iter("testcase"):
        cls, name = case.get("classname", ""), case.get("name", "")
        status = "passed"
        for child in case:
            if child.tag in ("failure", "error"):
                status = "failed"
            elif child.tag == "skipped" and status == "passed":
                status = "skipped"
        nid = (cls, name)
        if nid not in seen:
            order.append(nid)
            seen[nid] = status
        elif status == "failed" or (status == "skipped" and seen[nid] == "passed"):
            seen[nid] = status
    reason = "failed; see the raw suite output in run.log"
except Exception as exc:
    reason = "no usable junit report from the run (%s); every declared id is published as failed" % exc
    seen, order = {}, []
reported = {c + "." + n for c, n in seen}
missing = 0
for joined in ids:
    if joined in reported:
        continue
    cls, _, name = joined.rpartition(".")
    order.append((cls, name)); seen[(cls, name)] = "failed"; missing += 1
rows = []
for nid in order:
    cls, name = nid
    body = ""
    if seen[nid] == "failed":
        body = "<failure message=%s/>" % X.quoteattr(reason)
    elif seen[nid] == "skipped":
        body = "<skipped/>"
    rows.append("<testcase classname=%s name=%s>%s</testcase>" % (X.quoteattr(cls), X.quoteattr(name), body))
open(target, "w").write('<?xml version="1.0" encoding="utf-8"?><testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
print("[publish] wrote %s: %d cases (%d declared ids added as failed)" % (target, len(rows), missing))
PYCOMPLETE
  rm -f "$_tmp" 2>/dev/null || true
}

set +e
if [ -n "$refused" ]; then
  log "ERROR: model.patch touches$refused; every declared id will report failed"
  publish_failed "$RPTDIR/base.xml" p2p_node_ids "refused: the patch touches$refused"
  publish_failed "$RPTDIR/new.xml" f2p_node_ids "refused: the patch touches$refused"
elif [ ! -f /app/node_modules/vitest/vitest.mjs ]; then
  log "ERROR: node_modules/vitest is missing from the image; every declared id will report failed"
  publish_failed "$RPTDIR/base.xml" p2p_node_ids "vitest is missing from the image"
  publish_failed "$RPTDIR/new.xml" f2p_node_ids "vitest is missing from the image"
else
  # pass-to-pass: every test file the base commit ships, named explicitly,
  # except tests/large.test.ts, whose last case grades a wall-clock ratio
  # between two compiles and fails on a loaded machine whatever the code
  # does. Its ids are not declared, so nothing about it is graded.
  P2P_RUN=$(cd /app && git ls-tree -r --name-only "$BASE" -- tests | grep '\.test\.ts$' | grep -v '^tests/large\.test\.ts$' | tr '\n' ' ')
  run_suite "$RPTDIR/base.xml" p2p_node_ids $P2P_RUN

  # Between the suites: everything the second suite reads is put back and
  # checked again against the digests this shell already holds.
  git -C /app checkout -q "$BASE" -- tests vitest.config.ts tsconfig.json package.json 2>/dev/null || true
  if [ "$NEW_OK" = 1 ]; then
    for f in $NEW_FILES; do
      mkdir -p "/app/$(dirname "$f")" 2>/dev/null || true
      cp "$KEEP/$f" "/app/$f" 2>/dev/null || true
    done
    if ! new_matches; then
      NEW_OK=0
      log "ERROR: held-back test sources were altered during the pass-to-pass suite and could not be restored; every fail-to-pass id will be published as failed"
      log_mismatch
    else
      echo "+ held-back files re-checked before their suite: OK" >> "$RUN_LOG" 2>/dev/null || true
    fi
  fi
  if [ "$NEW_OK" = 1 ]; then
    run_suite "$RPTDIR/new.xml" f2p_node_ids $NEW_RUN
  else
    publish_failed "$RPTDIR/new.xml" f2p_node_ids "held-back test sources did not match the shipped digests"
  fi
fi
sweep

# Publish the reports read-only, only after the sweep.
[ -f "$RPTDIR/base.xml" ] && cp "$RPTDIR/base.xml" "$BASE_REPORT"
[ -f "$RPTDIR/new.xml" ] && cp "$RPTDIR/new.xml" "$NEW_REPORT"
chmod 0444 "$BASE_REPORT" "$NEW_REPORT" 2>/dev/null || true
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
