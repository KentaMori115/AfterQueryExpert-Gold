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
# held-back automatic working tests (fail-to-pass). Reports are not written by the
# process that runs submitted code: a parent that never imports /app mints a
# per-run token, hands it to a pytest child on stdin, hears one verdict line
# per case back on a dedicated descriptor, and writes the XML only after the
# child has exited, so no report file exists while /app code can run. Both
# interpreters run isolated (-I); the child appends /app and /app/src LAST to
# sys.path, so pytest and the standard library always resolve from the
# interpreter's own installation and never from the tree under test. The
# child takes an identity snapshot of every loaded pytest, pluggy and
# unittest module and class (TestCase assertions and runner included) before
# /app is importable and rechecks it at every verdict and
# at the end; a run that altered the framework sends no END and the publisher
# then publishes every declared id as failed, as it does for any id the run
# never reported. The child runs as an unprivileged user (nobody, via
# setpriv) whenever this script is root, so nothing imported from /app can
# write to /tests, /verify or /logs, or signal the root-owned publisher;
# /tests/grader.py and /tests/config.json are made read-only, copied, and
# restored from the copies if their digests moved before grading. The
# graded pass-to-pass sources, the shared fixtures, the scheme plans and the
# recorded golden answers are restored to their base-commit content and
# digest-checked, any conftest.py the tree grew is removed along with stale
# bytecode, and no process started by a suite survives into grading.
unset PYTHONPATH
unset PYTEST_ADDOPTS
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
mkdir -p "$RPTDIR" 2>/dev/null || true
chmod 0755 "$VDIR" 2>/dev/null || true
chmod 0700 "$RPTDIR" 2>/dev/null || true
printf '[pytest]\naddopts =\n' > "$VDIR/pytest.ini"

# The grader and its configuration are root-owned and read-only from here
# on, and a private copy of each is kept so that, should either move while
# the suites run, the original is put back before grading.
chmod 0444 /tests/grader.py /tests/config.json 2>/dev/null || true
mkdir -p "$VDIR/keep" 2>/dev/null && chmod 0700 "$VDIR/keep" 2>/dev/null || true
cp /tests/grader.py "$VDIR/keep/grader.py" 2>/dev/null || true
cp /tests/config.json "$VDIR/keep/config.json" 2>/dev/null || true
TESTS_SHA=$(cd /tests 2>/dev/null && sha256sum grader.py config.json 2>/dev/null)

P2P_FILES="tests/test_api.py tests/test_golden.py tests/test_packaging.py tests/test_readme.py tests/test_rules_doc.py tests/sim/test_ars.py tests/sim/test_lamps.py tests/sim/test_machine.py tests/sim/test_machine_failures.py tests/sim/test_machine_points.py tests/sim/test_scenario.py tests/sim/test_scenario_dispatch.py tests/sim/test_state.py tests/unit/test_scheme.py tests/unit/test_signal.py tests/verify/test_check_setting.py tests/verify/test_guidance.py tests/verify/test_rules.py tests/verify/test_standards_are_used.py"
SUPPORT_FILES="tests/conftest.py tests/data/kingsmoor.sbx tests/data/marlow-crossing.sbx tests/data/hallowgate-warning.sbx tests/data/netherby-mileage.sbx tests/data/thornley-platform.sbx tests/data/down-through-the-junction.sbs tests/data/booked-through.sbs tests/data/points-failure.sbs tests/data/split/area.sbx tests/data/split/scheme.sbx tests/golden/kingsmoor-control.csv tests/golden/kingsmoor-locking.txt tests/golden/kingsmoor-points.txt tests/golden/kingsmoor-report.txt tests/golden/kingsmoor.sbj"
NEW_FILES="tests/verify/test_unattended_signals.py tests/sim/test_unattended_working.py"

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
    """Every loaded module of the frameworks whose decisions the verdicts
    rest on: pytest and pluggy, which run the session, and unittest, whose
    TestCase assertions the graded cases may be written against."""
    found = {}
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        if name in ("pytest", "pluggy", "unittest") or name.startswith(
                ("_pytest.", "pluggy.", "unittest.")):
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
        fh.write(
            "import unittest\n\n\ndef test_passes():\n    assert 1 == 1\n\n\n"
            "def test_fails():\n    assert [1] == [2]\n\n\n"
            "class TestCase(unittest.TestCase):\n"
            "    def test_passes(self):\n        self.assertEqual(1, 1)\n\n"
            "    def test_fails(self):\n        self.assertEqual([1], [2])\n\n"
            "    def test_raises(self):\n"
            "        with self.assertRaises(ValueError):\n"
            "            int('x')\n"
        )
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
    sys.path.append("/app/src")
    import unittest  # noqa: F401
    import unittest.case  # noqa: F401
    import unittest.loader  # noqa: F401
    import unittest.result  # noqa: F401
    import unittest.runner  # noqa: F401
    import unittest.suite  # noqa: F401
    import unittest.util  # noqa: F401
    import unittest.mock  # noqa: F401
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
import pwd
import shutil
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
    command = [sys.executable, "-I", os.path.join(vdir, "child.py"),
               str(w_fd), ini] + files
    # The child runs code from /app, so it runs as nobody whenever this
    # publisher is root: it can then neither write to /tests, /verify or
    # /logs nor signal this process, and its only channel is the pipe.
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
            command = [setpriv, "--reuid=%d" % nobody.pw_uid,
                       "--regid=%d" % nobody.pw_gid, "--clear-groups",
                       "--inh-caps=-all"] + command
            print("[publish] child runs as nobody (uid %d)" % nobody.pw_uid,
                  flush=True)
        except KeyError:
            print("[publish] no nobody user; child runs as root", flush=True)
    else:
        print("[publish] child runs unprivileged-as-is (euid %d)"
              % os.geteuid(), flush=True)
    child = subprocess.Popen(
        command,
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

# Every conftest.py goes, along with stale bytecode; tests/conftest.py is then
# restored from the base commit by the loop below and digest-checked, so a
# conftest planted anywhere else in the tree never runs.  -c above already
# pins configuration to the verifier's own ini.
find /app -name 'conftest.py' -delete 2>/dev/null || true
find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

# Restore every graded pass-to-pass source and the fixture module to their
# base-commit content, then digest-check. HEAD in this container is the
# base commit; model.patch and test.patch touch the working tree only.
for f in $P2P_FILES $SUPPORT_FILES; do
  git -C /app checkout HEAD -- "$f" 2>/dev/null || true
done
cat > "$VDIR/p2p.sha256" <<'SHA_P2P'
6bc39c5982a4082c239b0b95336319aeb766461044fdaa119a7abd06f369e53b  tests/test_api.py
7bdf354507ca42193bd861d5ffee01b4e8ff3e0a74ce8b034eb4f509182dc907  tests/test_golden.py
7d1ec57617465ecfe2c5a56dba2126bab0b042bedee02ac578c645fb85d62634  tests/test_packaging.py
79c2eae04180a271db087e9497a2ec0d329745b165fec2e553ec69abb7991f40  tests/test_readme.py
5e20466c73265ac8f6e2dc24952aea335f1eeccf438832a5b89d50f6f73de240  tests/test_rules_doc.py
1548d1f0404890d3a7265b7221d27f07c76fd8b6f6ae2cfd83488cbaa242609b  tests/sim/test_ars.py
95aa8ab73f1930e3f1bec634f0dc160223134fdede39c1eb221ab52e6ebdc326  tests/sim/test_lamps.py
363b0465b1ca5e43ef0c0b0188278d7340911110d9f0b877d458f579587760df  tests/sim/test_machine.py
49743f593c208a9d76b92f531df5001cc315b506e5924845965a0f3cf75ff860  tests/sim/test_machine_failures.py
4f3ee4756f877306c38d6ae520ae75ade1d7c9c1955885b10ecf5903c2941211  tests/sim/test_machine_points.py
f49963e9e29b02a31f99a354ecb01aeddf98535fdd1fa1daa206146d25e91111  tests/sim/test_scenario.py
26726f383b739166e10c653f12933db972a38a859539052f348d566e3ceeeba1  tests/sim/test_scenario_dispatch.py
bd2df7d60bf33ebceda05d4e41e139cb8fe9e5a305d010f437b7d767c62c2fe6  tests/sim/test_state.py
22f406b3566683ac520e69e29fe3f5715e043bbdb7365895221ea9b55b0839f6  tests/unit/test_scheme.py
279f83948ed661640ab229b34a832ed6b2de2f67e0267bc9bc4f6b72f4746f0a  tests/unit/test_signal.py
d28f01d637b6f560975ed79987c923d79b6f37765d8a6cadfe36428360476c8f  tests/verify/test_check_setting.py
7574366a2b82f59cd2d0ed739c08befca0079c89ae39239d02a3ff29458b929a  tests/verify/test_guidance.py
d4ee8769f5c09206b52837ffb89285487eaab5d6fe27fda5c14f252676e75e0d  tests/verify/test_rules.py
04ae6bbd05568498ba6e3ea71636fcfd141316a2914a9f7952626d88547c2612  tests/verify/test_standards_are_used.py
edb9644a046676631c8c185d34ffc6f8895d611dfb33689a546107af9f5841cb  tests/conftest.py
6ed48de830f22a592f3a8bcb976f1ad8e6343090697ffd519fab577f2b4df7ea  tests/data/kingsmoor.sbx
1dfe54ce20788c2bc05d274f84e6890ddfbd3750005e3d3d968ea01a35d9e652  tests/data/marlow-crossing.sbx
c5670a6133e9f1db8e82d9cc2c7533cfb0852862ce8bdd5583e98221a210bd21  tests/data/hallowgate-warning.sbx
3330a7a6747d82170e71d0f1cd279563cd86319b535bd15916aa0d018837f89d  tests/data/netherby-mileage.sbx
407937052bd176b97466e6001e4c9ae61215c2467a5a878b5e2de79f38223e5d  tests/data/thornley-platform.sbx
b5dddf511a1f7e6dab2bafc2fc34c2d1ad67a5676a5195c531e7f183b9710a38  tests/data/down-through-the-junction.sbs
a66df5047d3d2ff0b9476dc6573bde9692ddc2f7975f35713722013f7660c614  tests/data/booked-through.sbs
8316ad64f4060a7043bfa5c0611607165881c7315e6d2f4193e2fa7a30b3701a  tests/data/points-failure.sbs
7b25f0267e16ec66ae654dc7d0e027917dc320b591e6e4796054da835fae4e5d  tests/data/split/area.sbx
2c38b03ddfde674aeb7936565d4f991c1634cf7a0d3529cab425f2acfd8a5b64  tests/data/split/scheme.sbx
3ccc479fa6d5fda38becfecdadf08ae49a0934de520d7bcdff1c7c1d1655ed6b  tests/golden/kingsmoor-control.csv
91f94bd54c8eec0be4487a61ef357f257400dff53ea441097dbc66afb63fc8d8  tests/golden/kingsmoor-locking.txt
4f4b4e394124ddc29486530ce9acefc787aa9fd99a9e5998d8a1fe6a1f4ccaea  tests/golden/kingsmoor-points.txt
514ee56073a80e575ea6093e8bcf9c670658128086befa77ec7aa405d907fb09  tests/golden/kingsmoor-report.txt
b8a555a57ea27e400bc608ccfeeef02e0c83cb03df64e045a6393420307f9ffa  tests/golden/kingsmoor.sbj
SHA_P2P
cat > "$VDIR/new.sha256" <<'SHA_NEW'
f012c969a84816539760d863db1ad624e0ad3d5d01b6d551129e47ff388c274d  tests/verify/test_unattended_signals.py
dafa5942c0cdc4eb4744270918cd68e991f65d94065e84b46a45b8751bdb01ab  tests/sim/test_unattended_working.py
SHA_NEW

P2P_OK=1
if ! (cd /app && sha256sum -c "$VDIR/p2p.sha256" >/dev/null 2>&1); then
  P2P_OK=0
  log "ERROR: pass-to-pass sources (or the fixture module) do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
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

# The grader and its configuration must be the bytes this script started
# with; anything else is put back from the private copies before grading.
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
