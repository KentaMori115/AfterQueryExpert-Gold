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
# Two pytest selections: the repository's own suite (pass-to-pass) and the
# held-back interval tests (fail-to-pass). Reports are not written by the
# process that runs submitted code: a parent that never imports /app mints a
# per-run token, hands it to a pytest child on stdin, hears one verdict line
# per case back on a dedicated descriptor, and writes the XML only after the
# child has exited, so no report file exists while /app code can run. Both
# interpreters run isolated (-I); the child appends /app LAST to
# sys.path, so pytest and the standard library always resolve from the
# interpreter's own installation and never from the tree under test. The
# child takes an identity snapshot of every loaded pytest and pluggy module
# and class before /app is importable and rechecks it at every verdict and
# at the end; a run that altered the framework sends no END and the publisher
# then publishes every declared id as failed, as it does for any id the run
# never reported. The
# graded pass-to-pass sources and the two base-commit conftest.py files are
# restored to their base-commit content and digest-checked, every other
# conftest.py is removed along with stale bytecode, and no process started by
# a suite survives into grading.
unset PYTHONPATH
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
mkdir -p "$RPTDIR" 2>/dev/null || true
printf '[pytest]\naddopts =\n' > "$VDIR/pytest.ini"

P2P_FILES="tests/test_aggregation.py tests/test_binder.py tests/test_cli.py tests/test_evaluator.py tests/test_execution.py tests/test_functions.py tests/test_integration.py tests/test_joins.py tests/test_lexer.py tests/test_optimizer.py tests/test_parser.py tests/test_plan.py tests/test_schema.py tests/test_session.py tests/test_storage.py tests/test_types.py tests/test_unparser.py tests/test_util.py"
SUPPORT_FILES="tests/conftest.py conftest.py"
NEW_FILES="tests/test_intervals.py tests/test_interval_queries.py"

# The pytest child: runs the suite in-process and streams verdicts.
cat > "$VDIR/child.py" <<'PYCHILD'
import os
import sys


def to_pair(nodeid):
    path, _, rest = nodeid.partition("::")
    if path.startswith("/app/"):
        path = path[len("/app/"):]
    mod = path[:-3] if path.endswith(".py") else path
    mod = mod.replace("/", ".")
    parts = rest.split("::") if rest else []
    name = parts[-1] if parts else ""
    cls = ".".join([mod] + parts[:-1])
    return cls, name


def framework_modules():
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name == "pytest" or name == "pluggy" or name.startswith(("_pytest.", "pluggy.")):
            found[name] = mod
    return found


def decides(value):
    """Whether an attribute can change what the framework does: a function, a
    class or a descriptor. Plain data (flags, caches, counters) is not a
    decision point and pytest legitimately writes some of it while it runs."""
    return callable(value) or isinstance(value, (property, classmethod, staticmethod))


def snapshot_framework():
    """Every decision point of every loaded pytest/pluggy module, and of every
    class they define, held by reference so identity can be rechecked."""
    modules = {}
    classes = {}
    for name, mod in framework_modules().items():
        attrs = {k: v for k, v in vars(mod).items() if decides(v)}
        modules[name] = (mod, attrs)
        for key, value in attrs.items():
            if isinstance(value, type) and getattr(value, "__module__", None) == name:
                members = {k: v for k, v in vars(value).items() if decides(v)}
                classes[(name, key)] = (value, members)
    return modules, classes


def framework_drift(guard):
    """Every decision point that is not the object it was, or was added,
    as a set of hashable descriptions."""
    modules, classes = guard
    drift = set()
    for name, (mod, attrs) in modules.items():
        if sys.modules.get(name) is not mod:
            drift.add(("swap", name))
        live = vars(mod)
        for key, value in attrs.items():
            if key not in live or live[key] is not value:
                drift.add(("mod", name, key, type(live.get(key)).__name__))
        for key, value in live.items():
            if key not in attrs and decides(value):
                drift.add(("mod", name, key, type(value).__name__))
    for (name, key), (cls, members) in classes.items():
        live = vars(cls)
        for member, value in members.items():
            if member not in live or live[member] is not value:
                drift.add(("cls", name, key, member, type(live.get(member)).__name__))
        for member, value in live.items():
            if member not in members and decides(value):
                drift.add(("cls", name, key, member, type(value).__name__))
    return drift


def calibrate(guard, ini, pytest):
    """What pytest does to itself during a session, measured on a session
    that runs nothing from /app: a two-test file written here. Only drift
    beyond this set is treated as tampering in the real run."""
    import tempfile
    folder = tempfile.mkdtemp(prefix="calib-")
    with open(os.path.join(folder, "test_calibration.py"), "w") as fh:
        fh.write("def test_passes():\n    assert 1 == 1\n\n\ndef test_fails():\n    assert [1] == [2]\n")
    allowed = set()

    class Observer:
        def pytest_runtest_logreport(self, report):
            allowed.update(framework_drift(guard))

    pytest.main(
        ["-q", "-p", "no:cacheprovider", "-c", ini, "--rootdir=" + folder, folder],
        plugins=[Observer()],
    )
    allowed.update(framework_drift(guard))
    return allowed


def main():
    token = sys.stdin.readline().strip()
    fd = int(sys.argv[1])
    ini = sys.argv[2]
    files = sys.argv[3:]
    # Bound now, before anything under /app can run: rebinding os.write or
    # os.getpid later changes nothing here, and a forked copy of this process
    # never reports.
    write = os.write
    getpid = os.getpid
    owner = getpid()
    sys.path.append("/app")
    import pytest
    import pluggy  # noqa: F401
    import _pytest.reports  # noqa: F401
    import _pytest.runner  # noqa: F401
    import _pytest.python  # noqa: F401
    import _pytest.main  # noqa: F401
    import _pytest.nodes  # noqa: F401
    import _pytest.outcomes  # noqa: F401
    import _pytest.skipping  # noqa: F401
    import _pytest.unittest  # noqa: F401
    import _pytest.fixtures  # noqa: F401
    import _pytest.assertion  # noqa: F401
    import _pytest.assertion.rewrite  # noqa: F401
    import _pytest.capture  # noqa: F401
    import _pytest.terminal  # noqa: F401
    print("[runner] pytest resolved from", pytest.__file__, flush=True)
    guard = snapshot_framework()
    allowed = calibrate(guard, ini, pytest)
    if framework_drift(guard):
        # A calibration session must leave the framework as it found it.
        print("[runner] framework did not settle after calibration; no END will be sent", flush=True)
        os._exit(3)
    print("[runner] framework guard: %d decision points, %d self-changes allowed"
          % (sum(len(a) for _, a in guard[0].values()) + sum(len(m) for _, m in guard[1].values()), len(allowed)),
          flush=True)
    state = {"n": 0, "tampered": False}

    class Recorder:
        def pytest_runtest_logreport(self, report):
            if getpid() != owner:
                return
            if framework_drift(guard) - allowed:
                state["tampered"] = True
                return
            fields = vars(report)
            when = fields.get("when")
            verdict = fields.get("outcome")
            if when == "call":
                if verdict == "passed":
                    outcome = "passed"
                elif verdict == "skipped":
                    outcome = "skipped"
                else:
                    outcome = "failed"
            elif verdict != "passed":
                outcome = "skipped" if verdict == "skipped" else "failed"
            else:
                return
            cls, name = to_pair(fields.get("nodeid", ""))
            line = "V %s %s %s\x1f%s\n" % (token, outcome, cls, name)
            write(fd, line.encode())
            state["n"] += 1

    rc = pytest.main(
        ["-q", "-p", "no:cacheprovider", "-c", ini, "--rootdir=/app"] + files,
        plugins=[Recorder()],
    )
    if getpid() != owner:
        os._exit(0)
    if state["tampered"] or framework_drift(guard):
        # The framework was altered while the suite ran, or was left altered.
        # Without END the publisher refuses the stream and every declared id
        # grades failed.
        print("[runner] framework tampered with; no END will be sent", flush=True)
        os._exit(3)
    write(fd, ("END %s %d\n" % (token, state["n"])).encode())
    sys.exit(int(rc))


main()
PYCHILD

# The publisher: never imports /app code, owns the token and the XML.
cat > "$VDIR/publish.py" <<'PYPUB'
import json
import os
import subprocess
import sys
import xml.sax.saxutils


def declared_ids(xml_path):
    """The ids /tests/config.json declares for this report, so a refused or
    incomplete run still publishes every one of them as failed."""
    try:
        with open("/tests/config.json") as fh:
            config = json.load(fh)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def main():
    vdir, ini, xml_path = sys.argv[1], sys.argv[2], sys.argv[3]
    files = sys.argv[4:]
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    child = subprocess.Popen(
        [sys.executable, "-I", os.path.join(vdir, "child.py"), str(w_fd), ini]
        + files,
        stdin=subprocess.PIPE,
        pass_fds=(w_fd,),
    )
    os.close(w_fd)
    child.stdin.write((token + "\n").encode())
    child.stdin.flush()
    child.stdin.close()

    rank = {"passed": 0, "skipped": 1, "failed": 2}
    results = {}
    order = []
    heard = 0
    ended = False
    valid = True
    declared = -1
    with os.fdopen(r_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if ended:
                # Nothing may follow END; a late line poisons the stream.
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                declared = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in rank or "\x1f" not in payload:
                    valid = False
                    break
                cls, _, name = payload.partition("\x1f")
                nid = (cls, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
            # Lines without the token are ignored: only the two interpreters
            # share the pipe, and only the child was handed the token.
    rc = child.wait()

    expected = declared_ids(xml_path)
    reason = None
    if not (valid and ended and declared == heard):
        reason = (
            "verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
            % (valid, ended, declared, heard)
        )
        print("[publish] %s; publishing every declared id as failed" % reason, flush=True)
        results, order = {}, []
    # Every declared id the run did not report is published as failed too, so
    # the report is always complete and a missing case cannot be told apart
    # from a failing one by anything but its message.
    # Ids are matched as the grader matches them, classname and name joined
    # by a dot, because a test name may itself carry dots.
    reported = {cls + "." + name for cls, name in results}
    missing = 0
    for joined in expected:
        if joined in reported:
            continue
        cls, _, name = joined.rpartition(".")
        nid = (cls, name)
        order.append(nid)
        results[nid] = "failed"
        reported.add(joined)
        missing += 1

    esc = xml.sax.saxutils.quoteattr
    rows = []
    for nid in order:
        cls, name = nid
        status = results[nid]
        body = ""
        if status == "failed":
            message = reason or "failed; see the raw suite output in run.log"
            body = "<failure message=%s/>" % esc(message)
        elif status == "skipped":
            body = "<skipped/>"
        rows.append(
            "<testcase classname=%s name=%s>%s</testcase>"
            % (esc(cls), esc(name), body)
        )
    doc = (
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<testsuite tests=\"%d\">%s</testsuite>" % (len(rows), "".join(rows))
    )
    with open(xml_path, "w") as fh:
        fh.write(doc)
    print(
        "[publish] wrote %s: %d cases (%d declared ids added as failed), child rc %s"
        % (xml_path, len(rows), missing, rc),
        flush=True,
    )


main()
PYPUB
chmod 0444 "$VDIR/child.py" "$VDIR/publish.py" 2>/dev/null || true

# Exactly two conftest.py files exist at the base commit, /app/conftest.py and
# /app/tests/conftest.py; both are restored and pinned below. Any other
# conftest.py came from the tree under test and is removed, as is stale
# bytecode; -c above already pins configuration to the verifier's own ini.
find /app -name 'conftest.py' ! -path /app/conftest.py ! -path /app/tests/conftest.py -delete 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find /app -name '*.pyc' -delete 2>/dev/null || true

# Restore every graded pass-to-pass source and the two conftest.py files to
# their base-commit content, then digest-check. HEAD in this container is the
# base commit; model.patch and test.patch touch the working tree only.
for f in $P2P_FILES $SUPPORT_FILES; do
  git -C /app checkout HEAD -- "$f" 2>/dev/null || true
done
cat > "$VDIR/p2p.sha256" <<'SHA_P2P'
c89e881f93d9d01414a426289a393268268ce7bda6d10ce886ce4dc2ac7b86e3  tests/test_aggregation.py
c1955c0df32c7f2b8070b172197434e53b197cdca211b5c87c379545b32380a8  tests/test_binder.py
e32c4716273372217a849b783b1eed1aa23f930beda6602dacd6620054a4e37e  tests/test_cli.py
66c1ccf69481b2a71733af5c35ccbfbf2d25f69a3f92c9600d4dcbf21c226f48  tests/test_evaluator.py
b7d8888df8f8d439f3fd7c690b4c9d809b6dc1dc87895b518044495d39260d88  tests/test_execution.py
f5ffd6740d41d7c133ca61a3138963d082a4cd24921f1b7d67169ac11bdc8314  tests/test_functions.py
0199bbefa7a0e301935e9835576f69d40268f73ee02a5a8b0fddf0f00fbb5ea2  tests/test_integration.py
a18895ccb2af3817acd683f999ff9ed4672cdebacc16243ddac3ca177bf406df  tests/test_joins.py
8d0635e6605a913af0de2530a1d69c45ee9b64d4e234ac1151db6186977dfeb6  tests/test_lexer.py
04246fba5dcfe8de9a2d292a11d450464f7ef63730aebb9c61d979277ef5b7b4  tests/test_optimizer.py
69362c058c784054900df6bf26f3f4e403647eb382310242fd26fb35a008e018  tests/test_parser.py
5d3bc92c4edffe9b5ba65e93b783aac9228fe1c71ce3e35b8ace8d6679b9d93c  tests/test_plan.py
c35924127b1599f3bc1543b2b46d75b735a076b9529e38d9b86a9a7c9b5ba852  tests/test_schema.py
e522882acb436f3be10cfb6ed131c558bdbc9eeba258967f7e2a33a1a099d4ec  tests/test_session.py
e65ac582fb8964ecfb8f72d282ffa2fca65514327b20e2ff893309c6f90f0e0f  tests/test_storage.py
5b996c5795b186716564b46f629f4d4f666aeaaa6d327c33b8eb47eb948a52fb  tests/test_types.py
04ab90fb5f66812eb3a026ab82d06e775c85c42144e3ff6ee602e2a23d7fad25  tests/test_unparser.py
cf8a51014e962f440468cc4652d16ab284428355b953fea413ddad3e4d695798  tests/test_util.py
523ad23179825232d157e12145c04aca4540bfe4e1f58734bb6259fac12ea39a  tests/conftest.py
c8a00c05e857b145a4c420f1d68e3d8de65b0096291938fc97e4923e5dd35d90  conftest.py
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
fe32e5340bcd8c5f4d009ec9a731d13505c39a7658427e905883f3a70e8d1658  tests/test_intervals.py
bf32a1d9b94b817740428616e7e7dfa4953ef2e55893b0fc3bac6df13ca77b69  tests/test_interval_queries.py
SHA_NEW

P2P_OK=1
if ! (cd /app && sha256sum -c "$VDIR/p2p.sha256" >/dev/null 2>&1); then
  P2P_OK=0
  log "ERROR: pass-to-pass sources (or the base conftest.py files) do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
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
  _paths=""
  for _f in "$@"; do _paths="$_paths /app/$_f"; done
  echo "+ pytest -> $_xml ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$VDIR/pytest.ini" "$_xml" $_paths >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    timeout 900 python3 -I "$VDIR/publish.py" "$VDIR" "$VDIR/pytest.ini" "$_xml" $_paths >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
}

set +e
if [ "$P2P_OK" = 1 ]; then
  run_suite "$RPTDIR/base.xml" $P2P_FILES
fi
if [ "$NEW_OK" = 1 ]; then
  # every held-back file is digest-pinned above; only the test modules run
  NEW_RUN=""
  for _f in $NEW_FILES; do case "${_f##*/}" in test_*.py) NEW_RUN="$NEW_RUN $_f" ;; esac; done
  run_suite "$RPTDIR/new.xml" $NEW_RUN
fi

# Sweep: end anything that appeared during the suites and is still running,
# so no process spawned by code under test survives into grading. The chain
# of this script's own ancestors is exempt.
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

# Publish the reports read-only, only after the sweep.
[ -f "$RPTDIR/base.xml" ] && cp "$RPTDIR/base.xml" /logs/verifier/base.xml
[ -f "$RPTDIR/new.xml" ] && cp "$RPTDIR/new.xml" /logs/verifier/new.xml
chmod 0444 /logs/verifier/base.xml /logs/verifier/new.xml 2>/dev/null || true
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
