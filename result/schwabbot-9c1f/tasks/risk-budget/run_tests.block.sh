# >>> RUN TESTS (task-specific) <<<
# Two selections run under Django's own test runner: the repository's suite
# (pass-to-pass) and the held-back risk budget tests (fail-to-pass). There is
# no pytest in this image, so the JUnit XML is written here rather than by a
# reporter. Reports are not written by the process that runs submitted code: a
# parent that never imports /app mints a per-run token, hands it to a child on
# stdin, hears one verdict line per case back on a dedicated descriptor, and
# writes the XML only after the child has exited, so no report file exists
# while /app code can run. Both interpreters run isolated (-I); the child
# appends /app LAST to sys.path, so django, unittest and the standard library
# always resolve from the interpreter's own installation and never from the
# tree under test, and the graded modules are loaded from their exact paths
# because the image's site-packages ships a top level `tests` package of its
# own. The child takes an identity snapshot of every loaded unittest and
# django.test module and class before /app is importable, measures what the
# framework does to itself on a suite holding nothing from /app, and rechecks
# the snapshot after the project loads, at every verdict and at the end; a run
# that altered the framework sends no END and the publisher then publishes
# every declared id as failed, as it does for any id the run never reported.
# The child runs as an unprivileged user (nobody, via setpriv) whenever this
# script is root, so nothing imported from /app can write to /tests, /verify
# or /logs, or signal the root-owned publisher; /tests/grader.py and
# /tests/config.json are made read-only, copied, and restored from the copies
# if their digests moved before grading. The graded pass-to-pass sources are
# restored to their base-commit content and digest-checked, import-time hooks
# a submission could leave behind are removed along with stale bytecode, and
# no process started by a suite survives into grading.
unset PYTHONPATH
unset PYTHONSTARTUP

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
mkdir -p "$RPTDIR" 2>/dev/null || true
chmod 0755 "$VDIR" 2>/dev/null || true
chmod 0700 "$RPTDIR" 2>/dev/null || true

# The grader and its configuration are root-owned and read-only from here on,
# and a private copy of each is kept so that, should either move while the
# suites run, the original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
mkdir -p "$VDIR/keep" 2>/dev/null && chmod 0700 "$VDIR/keep" 2>/dev/null || true
cp /tests/grader.py "$VDIR/keep/grader.py" 2>/dev/null || true
cp /tests/config.json "$VDIR/keep/config.json" 2>/dev/null || true
TESTS_SHA=$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)

P2P_FILES="tests/test_offline.py tests/test_schwab_api.py tests/test_server_api.py tests/test_user_allow.py Users/tests.py"
SUPPORT_FILES="tests/__init__.py"
NEW_FILES="tests/test_risk_budget.py tests/test_risk_budget_admin.py"

@@CHILD@@

@@PUBLISH@@
chmod 0444 "$VDIR/child.py" "$VDIR/publish.py" 2>/dev/null || true

# Anything that runs at import time and is not part of the repository's own
# test surface goes, along with stale bytecode: the child starts from /verify,
# never from /app, but a submission is not the place these belong either.
find /app -maxdepth 2 -name 'conftest.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name 'sitecustomize.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name 'usercustomize.py' -delete 2>/dev/null || true
find /app -maxdepth 2 -name '*.pth' -delete 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Restore every graded pass-to-pass source to its base-commit content, then
# digest-check. HEAD in this container is the base commit; model.patch and
# test.patch touch the working tree only.
for f in $P2P_FILES $SUPPORT_FILES; do
  git -C /app checkout HEAD -- "$f" 2>/dev/null || true
done
cat > "$VDIR/p2p.sha256" <<'SHA_P2P'
@@SHA_P2P@@
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
@@SHA_NEW@@
SHA_NEW

P2P_OK=1
if ! (cd /app && sha256sum -c "$VDIR/p2p.sha256" >/dev/null 2>&1); then
  P2P_OK=0
  log "ERROR: pass-to-pass sources do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
  (cd /app && sha256sum -c "$VDIR/p2p.sha256" 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true
fi
NEW_OK=1
if ! (cd /app && sha256sum -c "$VDIR/new.sha256" >/dev/null 2>&1); then
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
fi

# Process snapshot before the suites, for the post-suite sweep.
proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)

run_suite() {
  _xml="$1"; shift
  echo "+ django test -> $_xml ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
}

set +e
if [ "$P2P_OK" = 1 ]; then
  run_suite "$RPTDIR/base.xml" $P2P_FILES
fi
if [ "$NEW_OK" = 1 ]; then
  run_suite "$RPTDIR/new.xml" $NEW_FILES
fi

# Sweep: end anything that appeared during the suites and is still running, so
# no process spawned by code under test survives into grading. The chain of
# this script's own ancestors is exempt.
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
for _pid in $(proc_list); do
  echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
  case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
  kill -9 "$_pid" 2>/dev/null || true
done

# The grader and its configuration must be the bytes this script started with;
# anything else is put back from the private copies before grading.
if [ -n "$TESTS_SHA" ] && [ "$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)" != "$TESTS_SHA" ]; then
  log "ERROR: /tests/grader.py or /tests/config.json changed while the suites ran; restoring the originals"
  chmod 0644 /tests/grader.py /tests/config.json 2>/dev/null || true
  cp "$VDIR/keep/grader.py" /tests/grader.py 2>/dev/null || true
  cp "$VDIR/keep/config.json" /tests/config.json 2>/dev/null || true
  chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
fi

# Publish the reports read-only, only after the sweep.
[ -f "$RPTDIR/base.xml" ] && cp "$RPTDIR/base.xml" /logs/verifier/base.xml
[ -f "$RPTDIR/new.xml" ] && cp "$RPTDIR/new.xml" /logs/verifier/new.xml
chmod 0444 /logs/verifier/base.xml /logs/verifier/new.xml 2>/dev/null || true
# >>> END RUN TESTS <<<
