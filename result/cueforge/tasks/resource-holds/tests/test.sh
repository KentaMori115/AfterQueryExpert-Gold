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
# held-back resource-hold tests (fail-to-pass). Reports are not written by the
# process that runs submitted code: a parent that never imports /app mints a
# per-run token, hands it to a pytest child on stdin, hears one verdict line
# per case back on a dedicated descriptor, and writes the XML only after the
# child has exited, so no report file exists while /app code can run. Both
# interpreters run isolated (-I); the child appends /app/src and /app LAST to
# sys.path, so pytest and the standard library always resolve from the
# interpreter's own installation and never from the tree under test. The
# child takes an identity snapshot of every loaded pytest and pluggy module
# and class before /app is importable and rechecks it at every verdict and
# at the end; a run that altered the framework sends no END and the publisher
# then publishes every declared id as failed, as it does for any id the run
# never reported. The
# graded pass-to-pass sources and the test_lab builders are
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

P2P_FILES="tests/cli/test_cli.py tests/contract/test_public_api.py tests/end_to_end/test_import.py tests/integration/test_compile_examples.py tests/integration/test_invalid_fixtures.py tests/integration/test_rehearse.py tests/integration/test_split_show.py tests/integration/test_store.py tests/integration/test_unknown_intervention.py tests/integration/test_workspace.py tests/property/test_invariants.py tests/unit/test_assertions.py tests/unit/test_builders.py tests/unit/test_canonical.py tests/unit/test_clock.py tests/unit/test_compiler_errors.py tests/unit/test_events.py tests/unit/test_evidence.py tests/unit/test_findings.py tests/unit/test_geometry.py tests/unit/test_graph.py tests/unit/test_identifiers.py tests/unit/test_loaders.py tests/unit/test_presentation.py tests/unit/test_reservations.py tests/unit/test_result.py tests/unit/test_schedule.py tests/unit/test_sheets.py tests/unit/test_state.py tests/unit/test_time.py tests/unit/test_trace.py tests/unit/test_yaml_on_key.py"
SUPPORT_FILES="test_lab/__init__.py test_lab/builders/__init__.py test_lab/builders/productions.py"
NEW_FILES="tests/integration/test_holds.py tests/unit/test_hold_reports.py"

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
    sys.path.append("/app/src")
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

# No conftest.py exists at the base commit, so any conftest.py came from the
# tree under test and is removed, as is stale bytecode; -c above already pins
# configuration to the verifier's own ini.
find /app -name 'conftest.py' -delete 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Restore every graded pass-to-pass source and the two support modules to
# their base-commit content, then digest-check. HEAD in this container is the
# base commit; model.patch and test.patch touch the working tree only.
for f in $P2P_FILES $SUPPORT_FILES; do
  git -C /app checkout HEAD -- "$f" 2>/dev/null || true
done
cat > "$VDIR/p2p.sha256" <<'SHA_P2P'
ef939f33cf6074c27722dabad2e3677b9b5066c2388489c761864021028af483  tests/cli/test_cli.py
48c72db58ac3aa7023b3ceee5b2b9ebab1aa414fc0d5acf6f66307a672b2ac21  tests/contract/test_public_api.py
38dadeb00c5c48febaf0ef362403d50f65aaa09e632071209f647a9f72b38816  tests/end_to_end/test_import.py
d87a9bcd497842905c3ac13603d25db53ef9db1c1360a65223c95eb1c93cc15a  tests/integration/test_compile_examples.py
2101a2ac1c95260bc27f9c5f8fd370b018fa1d3affed31a74c5525f41593cc9e  tests/integration/test_invalid_fixtures.py
e40fc55d2072c50e55a4c7681d4249411c09851a511b029bc1460a5f792057f1  tests/integration/test_rehearse.py
5256365bf7c1993623f6712f89bc194abe388ec758008124a51d4b203eb44210  tests/integration/test_split_show.py
3cfb16c1e9656179765dd967a9989e53a9348b8c909840bf1453ca8e5f75805e  tests/integration/test_store.py
eaa8f97a5df1f37d6f1110f38a8cc1ac28c10824be8f218e041f531b2c7fdee2  tests/integration/test_unknown_intervention.py
83154babd95925c7f25cf9c4174debbaf5686f011884b175ebca6e290dc51052  tests/integration/test_workspace.py
0c20784c56a6e7f66c7d9eb891568433f560f10fe665b61502e9047cb143b8c0  tests/property/test_invariants.py
c6160e2459d562cabce8562398b1bba848c36a53ebed94357512fae89c8c2286  tests/unit/test_assertions.py
55e727be098d0ac783a908132509bba00d82979b914b3bc917cd7e52506a6199  tests/unit/test_builders.py
5b9a52ac2264880a02f7ea5ff06e60b73519ba4c98bc698fc4d35a321eec184a  tests/unit/test_canonical.py
e8f93034b9660d234eb694a1cd5eb1032528a957733b9bcfc4158e7a7edbcc32  tests/unit/test_clock.py
3741430e199b032ab06c35f8d29740e3e33ebf4afff3b058ec3cb53f71be6c5a  tests/unit/test_compiler_errors.py
8bec3f77563bfd3dd626abe749236a20de5928873db01d4243515f9f8a4c2afc  tests/unit/test_events.py
0a6b8defd91b68650041e092d9b3309d03f9623fe8ef2d89ffb688a4fae191b8  tests/unit/test_evidence.py
870e2c2ca267214a9b349616cd841bb1b0e2325ecb447811f4ce36b2612b6724  tests/unit/test_findings.py
254b65754cb3b1030b211c0c60b73f9ad824f02d3b70c86002e50156df29fce8  tests/unit/test_geometry.py
ae84e96a3c68ebacdaef773af3172266965bcd3b6121e4aebe67b934ff0323fd  tests/unit/test_graph.py
a6d0cb1fb934b52b0c1606b0b4cc1343a7c9d097bce1088b8a20c00728220718  tests/unit/test_identifiers.py
0901d7e0667360722525120c745e35e912ed31ec336272549b2ffa16d9bca829  tests/unit/test_loaders.py
9527f64cdde5a2288393299e50591ea263559b52c8dcd794fd056ed1ade56971  tests/unit/test_presentation.py
60a909ca2fdbabab5da567651ec6e440ffe0fbf08e818348987cfab918c9d455  tests/unit/test_reservations.py
550e18b9618cbb38c5755ab2d174fd62929c5808657251c2177734bf68582b2f  tests/unit/test_result.py
6a3182bc06fd1582fa76fb1aac06519012732a7fe087473661b8efa4ecca12a3  tests/unit/test_schedule.py
267eb68add44a0fba498fdca9db4350ff0c16115d08f55e5a165459549f7109f  tests/unit/test_sheets.py
1271989a65bfc7b5fa22647d6ceaf433833affc008c57ba1eff009a07520c4a0  tests/unit/test_state.py
a57d53a7f70058b60798b135dcf99869a9704eddb86c23cacae72c9fef27519d  tests/unit/test_time.py
91c017939518be646b9c3c3333c0fe009b01bddd6d5f745518a6d08feba74ea5  tests/unit/test_trace.py
fdb3cfde7c5fe2c9f6f119b19fd024993c319a0680b1ff7dd602b3229e38019a  tests/unit/test_yaml_on_key.py
00e9cc2b161581ee701ac7b14aecb31534f3c044c95304ff187aa9e75c6ae53d  test_lab/__init__.py
2e0558ea1a7073fb5ccb45db34ade04bd3f2b8f60043ce4b7b50553f48422e16  test_lab/builders/__init__.py
395b0f5077d08982ea00a83488f746812889193b78c6654b5025702f5582552d  test_lab/builders/productions.py
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
c50220916cd3ccad15fe206a5e2d1721e7052d4a6e993d8c389da022dc5027a8  tests/integration/test_holds.py
d4fe27c729856c4ec13aaf0dd100880ca54360b952b4bee3d0672566a72769f1  tests/unit/test_hold_reports.py
SHA_NEW

P2P_OK=1
if ! (cd /app && sha256sum -c "$VDIR/p2p.sha256" >/dev/null 2>&1); then
  P2P_OK=0
  log "ERROR: pass-to-pass sources (or the test_lab builders) do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
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
