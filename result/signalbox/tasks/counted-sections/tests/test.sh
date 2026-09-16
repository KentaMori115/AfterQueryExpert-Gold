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
# held-back counting tests (fail-to-pass). Reports are not written by the
# process that runs submitted code: a parent that never imports /app mints a
# per-run token, hands it to a pytest child on stdin, hears one verdict line
# per case back on a dedicated descriptor, and writes the XML only after the
# child has exited, so no report file exists while /app code can run. Both
# interpreters run isolated (-I); the child takes the tree under test off
# sys.path entirely while it imports the framework and puts it back last
# afterwards, so pytest and the standard library always resolve from the
# interpreter's own installation and never from anything the submission
# shipped. The
# child takes an identity snapshot of every loaded pytest and pluggy module
# and class before /app is importable and rechecks it at every verdict and
# at the end; a run that altered the framework sends no END and the publisher
# then publishes every declared id as failed, as it does for any id the run
# never reported. The
# child runs as an unprivileged user (nobody, via setpriv) whenever this
# script is root, so nothing imported from /app can write to /app, /tests,
# /verify or /logs, or signal the root-owned publisher. The graded
# pass-to-pass sources and the suite's fixture module are restored to their
# base-commit content and digest-checked, every other conftest.py is removed
# along with stale bytecode, and no process started by a suite survives into
# grading. The held-back modules are copied into the root-only verifier
# directory once their digests match, and between the two suites everything
# the second suite reads is swept, restored from those copies or the base
# commit, and digest-checked again against digests this shell holds in
# memory, so code that ran during the first suite cannot leave a rewritten
# module behind for the second.
unset PYTHONPATH
unset PYTEST_ADDOPTS
export PYTEST_DISABLE_PLUGIN_AUTOLOAD=1

# Only root reads the verifier's own directory from here on. Knowing which ids
# are graded is the difference between forging a report and having to
# reproduce a whole run, and nothing the suites do needs that list.
chmod -R go-rwx /tests 2>/dev/null || true

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
KEEP="$VDIR/keep"
mkdir -p "$RPTDIR" "$KEEP" 2>/dev/null || true
printf '[pytest]\naddopts =\n' > "$VDIR/pytest.ini"

# The suites need somewhere to write: pytest's tmp_path fixture, and the
# calibration session the child runs before /app is importable. This is the
# only directory the child can write, and neither the publisher nor grading
# ever reads it.
SUITE_TMP="$VDIR/tmp"
mkdir -p "$SUITE_TMP" 2>/dev/null || SUITE_TMP=$(mktemp -d)
chmod 1777 "$SUITE_TMP" 2>/dev/null || true

# Drop privileges for the child. Submitted code executes inside it, so it must
# not be able to reach the verifier's own files, the reports, or the checkout
# it is graded against. When setpriv or the account is missing the block runs
# the child as the current user rather than refusing to run at all, and says
# so in the log.
RUNAS=""
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  RUN_UID=$(id -u nobody 2>/dev/null || echo 65534)
  RUN_GID=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)
  if setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups true >/dev/null 2>&1; then
    RUNAS="setpriv --reuid=$RUN_UID --regid=$RUN_GID --clear-groups"
    log "pytest child runs as uid $RUN_UID gid $RUN_GID"
  fi
fi
if [ -z "$RUNAS" ]; then
  log "no setpriv; the publisher drops the pytest child to nobody itself"
fi
export RUNAS SUITE_TMP

P2P_FILES="tests/cli/test_check_pieces.py tests/cli/test_cli_aspects.py tests/cli/test_cli_chainage.py tests/cli/test_cli_check_directory.py tests/cli/test_cli_check_json.py tests/cli/test_cli_check.py tests/cli/test_cli_colour.py tests/cli/test_cli_compare_json.py tests/cli/test_cli_diff.py tests/cli/test_cli_distance.py tests/cli/test_cli_draw.py tests/cli/test_cli_errors.py tests/cli/test_cli_examples.py tests/cli/test_cli_explain.py tests/cli/test_cli_export.py tests/cli/test_cli_fmt.py tests/cli/test_cli_graph.py tests/cli/test_cli_headway.py tests/cli/test_cli_locking.py tests/cli/test_cli_main.py tests/cli/test_cli_pack.py tests/cli/test_cli_panel.py tests/cli/test_cli_points.py tests/cli/test_cli_report.py tests/cli/test_cli_route.py tests/cli/test_cli_routes.py tests/cli/test_cli_set.py tests/cli/test_cli_show_detail.py tests/cli/test_cli_show.py tests/cli/test_cli_sim.py tests/cli/test_cli_since.py tests/cli/test_cli_table.py tests/cli/test_cli_waivers.py tests/cli/test_cli_where.py tests/interchange/test_compare.py tests/interchange/test_csv_io.py tests/interchange/test_findings.py tests/interchange/test_json_io.py tests/interchange/test_migrate.py tests/interchange/test_model_extras.py tests/interchange/test_model.py tests/interchange/test_report.py tests/interchange/test_schema.py tests/property/test_round_trip.py tests/render/test_geometry.py tests/render/test_legend.py tests/render/test_panel.py tests/render/test_svg_extras.py tests/render/test_svg.py tests/render/test_timeline.py tests/signalling/test_approach.py tests/signalling/test_aspects.py tests/signalling/test_berth.py tests/signalling/test_callon.py tests/signalling/test_conflict.py tests/signalling/test_crossing.py tests/signalling/test_emergency.py tests/signalling/test_flank.py tests/signalling/test_flank_traps.py tests/signalling/test_headway.py tests/signalling/test_interlocking.py tests/signalling/test_locking.py tests/signalling/test_overlap.py tests/signalling/test_points.py tests/signalling/test_profile_helpers.py tests/signalling/test_routefind.py tests/signalling/test_sighting.py tests/signalling/test_subroute.py tests/signalling/test_tpws.py tests/signalling/test_trap.py tests/signalling/test_warning.py tests/sim/test_ars.py tests/sim/test_driver.py tests/sim/test_history.py tests/sim/test_lamp_failures.py tests/sim/test_lamps.py tests/sim/test_leaving.py tests/sim/test_log.py tests/sim/test_machine_failures.py tests/sim/test_machine_points.py tests/sim/test_machine.py tests/sim/test_regulator.py tests/sim/test_replay.py tests/sim/test_reversal.py tests/sim/test_scenario_booking.py tests/sim/test_scenario_dispatch.py tests/sim/test_scenario_failures.py tests/sim/test_scenario.py tests/sim/test_scenario_reader.py tests/sim/test_scenario_times.py tests/sim/test_state.py tests/sim/test_timetable.py tests/sim/test_track_failures.py tests/sim/test_train.py tests/sim/test_world.py tests/tables/test_aspect_table.py tests/tables/test_control_table_crossings.py tests/tables/test_control_table.py tests/tables/test_diff.py tests/tables/test_index.py tests/tables/test_locking_table.py tests/tables/test_points_table.py tests/tables/test_render_columns.py tests/tables/test_render.py tests/tables/test_sorting.py tests/test_api.py tests/test_design_doc.py tests/test_docs.py tests/test_example_scenarios.py tests/test_examples.py tests/test_golden.py tests/test_packaging.py tests/test_performance.py tests/test_readme.py tests/test_rules_doc.py tests/test_scenario_docs.py tests/test_terminus.py tests/unit/test_ast.py tests/unit/test_braking.py tests/unit/test_chainage.py tests/unit/test_context.py tests/unit/test_crossing_decl.py tests/unit/test_cursor.py tests/unit/test_format.py tests/unit/test_graph.py tests/unit/test_include.py tests/unit/test_measure.py tests/unit/test_parser.py tests/unit/test_position.py tests/unit/test_profile.py tests/unit/test_reachability.py tests/unit/test_route.py tests/unit/test_scheme.py tests/unit/test_section.py tests/unit/test_signal.py tests/unit/test_slip_interlocking.py tests/unit/test_slip.py tests/unit/test_standards.py tests/unit/test_tokens.py tests/unit/test_traverse.py tests/unit/test_units.py tests/unit/test_validate.py tests/unit/test_walk.py tests/verify/test_check_aspect.py tests/verify/test_check_capacity.py tests/verify/test_check_crossing.py tests/verify/test_check_detection.py tests/verify/test_check_flank.py tests/verify/test_check_gradient.py tests/verify/test_check_layout.py tests/verify/test_check_locking.py tests/verify/test_check_overlap.py tests/verify/test_check_points.py tests/verify/test_check_protection.py tests/verify/test_check_reversible.py tests/verify/test_check_route.py tests/verify/test_check_setting.py tests/verify/test_check_sighting.py tests/verify/test_check_spacing.py tests/verify/test_check_standards.py tests/verify/test_guidance.py tests/verify/test_report_extras.py tests/verify/test_rules.py tests/verify/test_standards_are_used.py tests/verify/test_waivers.py"
SUPPORT_FILES="tests/conftest.py examples/ashcombe.sbx examples/ferrybridge-quay.sbx examples/scenarios/ashcombe-both-ways.sbs examples/scenarios/kingsmoor-branch.sbs tests/data/booked-through.sbs tests/data/down-through-the-junction.sbs tests/data/hallowgate-warning.sbx tests/data/kingsmoor.sbx tests/data/marlow-crossing.sbx tests/data/netherby-mileage.sbx tests/data/points-failure.sbs tests/data/split/area.sbx tests/data/split/scheme.sbx tests/data/thornley-platform.sbx"
NEW_FILES="tests/unit/test_reset_grouping.py tests/tables/test_head_listing.py"

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
    # The package is never installed in this image: it is importable only
    # because the environment sets PYTHONPATH to /app/src, and the block
    # unsets that before starting anything, so the tree under test reaches
    # sys.path here and nowhere else. It goes on last, after the framework is
    # already imported, so pytest comes from the interpreter's own
    # installation and never from anything the submission shipped.
    stdlib = [p for p in sys.path if not p.startswith("/app")]
    under_test = [p for p in sys.path if p.startswith("/app")]
    sys.path[:] = stdlib
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
    if pytest.__file__.startswith("/app"):
        print("[runner] pytest resolved from the tree under test; no END will be sent", flush=True)
        os._exit(3)
    print("[runner] pytest resolved from", pytest.__file__, flush=True)
    guard = snapshot_framework()
    # Only now does the code under test become importable, and only behind
    # everything the interpreter ships.
    sys.path.extend(under_test)
    sys.path.append("/app/src")
    sys.path.append("/app")
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
    # RUNAS drops the child to an unprivileged user; scratch is the only place
    # it may write. -B keeps it from leaving bytecode behind, and -I means the
    # environment below cannot steer the interpreter, only the suites. When
    # the shell found no setpriv, this process drops the child itself, so the
    # code under test never runs as root: the held-back modules are read by
    # pytest only after the fixture module has imported the package, and a
    # root child could rewrite them in that window.
    runas = os.environ.get("RUNAS", "").split()
    scratch = os.environ.get("SUITE_TMP", "/tmp")
    drop = None
    if not runas and os.geteuid() == 0:
        try:
            import pwd
            _pw = pwd.getpwnam("nobody")
            _uid, _gid = _pw.pw_uid, _pw.pw_gid
        except Exception:
            _uid, _gid = 65534, 65534

        def drop(uid=_uid, gid=_gid):
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            if os.getuid() != uid or os.geteuid() != uid:
                os._exit(97)

        print("[publish] no setpriv; publisher drops the child to uid %d gid %d itself"
              % (_uid, _gid), flush=True)
    try:
        child = subprocess.Popen(
            runas
            + [sys.executable, "-I", "-B", os.path.join(vdir, "child.py"), str(w_fd), ini]
            + files,
            stdin=subprocess.PIPE,
            pass_fds=(w_fd,),
            preexec_fn=drop,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "TMPDIR": scratch,
                 "HOME": scratch, "LC_ALL": "C.UTF-8"},
        )
    except Exception as exc:
        # Fail closed: a child that cannot be started unprivileged does not
        # run; with nothing on the pipe the stream below is refused and every
        # declared id is published as failed.
        print("[publish] refused: could not start the child unprivileged (%s); "
              "every declared id is published as failed" % exc, flush=True)
        child = None
    os.close(w_fd)
    if child is not None:
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
    rc = child.wait() if child is not None else 98

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

# The digests live in this shell's memory, not in a file anything else can
# reach: the graded pass-to-pass sources plus the fixture module at the base
# commit, and the held-back modules as shipped.
P2P_SHA=$(cat <<'SHA_P2P'
cdd4c1cf456d007d98afbfea22e3c535852363df970d13c031e12c832f90b54e  tests/cli/test_check_pieces.py
5e0539634a435aed8c2454b638fb35d5c7c085f23d0e8056d3574c46392371d9  tests/cli/test_cli_aspects.py
23ff4b3f1f40940dd25247f33ef8e2f54a53a2e2066675b4177cb07583d3200c  tests/cli/test_cli_chainage.py
e3604596877e53ec7ec6a9d9eb8034268f9da1456c6df0322f9f4fa8db91461d  tests/cli/test_cli_check_directory.py
0c4b2f945e0646e972b7b4b82da6c16899c61e537505bda164f5f1518be7fca1  tests/cli/test_cli_check_json.py
dcf8ff30fb07249db35a8c6b2b6bbbcd181655a0296f1e1dab97260c640a53a9  tests/cli/test_cli_check.py
17eb4aae961b5dd4ab7f2f0101b8b81fbafc8953576001fc7e799b90872ab1d1  tests/cli/test_cli_colour.py
aa7f86fb80c5e665aa969b9dac940aa9c75e46bab96875b1ea971a767f38fd7e  tests/cli/test_cli_compare_json.py
aafd33da80a5d30bcfcfec9605ebf390d905e8e98adc8de0a3a512d0d7fd5b1a  tests/cli/test_cli_diff.py
ba9461a0e55fa18d530db109a251d5c7d9aa682b675acc90ab2604977bfd68e4  tests/cli/test_cli_distance.py
8bd0138c41031e6a4b914196ee984b219754228a3b7280caaf3435f60aaa5329  tests/cli/test_cli_draw.py
89506bf8c64c7a56b8e59800bbcf697568872e2923992c8139334b2b51d31419  tests/cli/test_cli_errors.py
5875d433d26bf5c205a81cb65c2bbaaedb8ab8762a0f6bf3232fa4e65d9e11f8  tests/cli/test_cli_examples.py
b0c3df2211969bd3a50e9a1d431822fbef0db9fddfa927477ebd07d8c3a885e2  tests/cli/test_cli_explain.py
ce86ba40fc515ab392f462acda1b02dc761a5a744d502446fcc5efa2aaa1942d  tests/cli/test_cli_export.py
c4409c3dd57210431ecf14284ce972cf3790a9b8cb0889cbd65dc8adb3edd4fb  tests/cli/test_cli_fmt.py
88f5e6156c1893712c4cdfc6eaf2dc9e8ce80dbc203c12825862ddae2c950482  tests/cli/test_cli_graph.py
8d88ddcb4df55a88d233c67b21ad95af9b9ca1710c4726441ffb1b9fdb843081  tests/cli/test_cli_headway.py
2cbfa8d58165fa413b18ddd06b2f7d56b145015399756c88fd428bcbd97e9909  tests/cli/test_cli_locking.py
1d94d060fe4cd3f362af71e6b6d6775fa5c0fea4b6fd567651f07ebdd1d222ff  tests/cli/test_cli_main.py
904b72a28130d514efd3f2eef2fac865397d42c5511939aa35ec9f78a85f7ad2  tests/cli/test_cli_pack.py
a77afed21bf827441c5e72f670c86763dd14484ffe7b3ae604d405a2b23e48a5  tests/cli/test_cli_panel.py
33106b8d0158458f98ad6fe353c8dab0af3f60903d8229643dc560db86f6ba8b  tests/cli/test_cli_points.py
2272483c28db07b34f2d94cadc882e4deb756fa9c4f4546d00ec4ed4cd916c36  tests/cli/test_cli_report.py
192aab76f7f0f417c8152df83984d673e3677af4607baa8c38748f9227593776  tests/cli/test_cli_route.py
3f2f943a1747818b32dcb641a66542172335a2ee50e90d6ce48f9a4901a0b0c9  tests/cli/test_cli_routes.py
283f9bab3d7a7ea2caf25cd82a37f536e1676c949185c029017662631d9e5b23  tests/cli/test_cli_set.py
d2d4b3dfceba63a1a0f729dbb7f6748bb6cff6f3df3e69e5e57ca934c5bf12cf  tests/cli/test_cli_show_detail.py
7990bfe25abcad11eb0cc8e8dc935e9b0eb0c8be3587b5be0721ffbc2f7c064d  tests/cli/test_cli_show.py
ebf462448a2eda5dcc129bbd0ad9d670b071eb68e6b5475e5864e83d385110fb  tests/cli/test_cli_sim.py
9c89d0af56b0873e8c76624cd49dc24d3bf09bf7808f66a91d7940d1262c3e6a  tests/cli/test_cli_since.py
c830d15fe2fe624e4b76bb6ab1f17f122bd00aae5571672ccb003aed1124a366  tests/cli/test_cli_table.py
cfcdd632cfca5889e84aa126bdc19eaa4104da3ef9334ae410eb8f98a02324f9  tests/cli/test_cli_waivers.py
8ecf88dca30bc1d0cb15a2e8ddfa7c33d18d65b2cd346883fb33d466a2c1c633  tests/cli/test_cli_where.py
48ee40fe739a70c9692e7ce5d5c9fdc0fcba3c4f3473a73b0fa1f9daad4280a2  tests/interchange/test_compare.py
f7c98d98b4098704c498674bf577b5c883ae602e17f54a2e4a4b90f8412bf636  tests/interchange/test_csv_io.py
38cba2d94bb85ee42ad8c95a5eb111c46c7ab8b4838a5ed50c03e80e4a98d494  tests/interchange/test_findings.py
777b54b53be1c38adc6cecf27b76f506b27734e94a82ea1c819ec97d06fc6159  tests/interchange/test_json_io.py
56fc2e7a363a179368660892e5aba0edca18c7961c131fc67fb9b1a2e110d46a  tests/interchange/test_migrate.py
96f3bf00b624e020d95d4b1d3b2d58b08d09067ebad73479f0bb3aa24a4829ee  tests/interchange/test_model_extras.py
a2f1d2ace4ba0fa03a96463b0d0ba8e003a8afdbd2f30c60dc1d1d0e9da6efab  tests/interchange/test_model.py
3d8e33a61a6810df3520a378fc241ca876822b0516b1e3388539b25f2b1f3567  tests/interchange/test_report.py
a00fbf44c724c065bb7b962bbdf36d256d0e576dcf00dda1b3cda7ef9853181c  tests/interchange/test_schema.py
2887dd9bcc7906b014fe4cb58c5cf6444b37d9db6fc86980fed55cb6be1cd5cc  tests/property/test_round_trip.py
dd24298cbf40536c9be445cbd72525b450602ff7db2a97e052b4b459b573c0ca  tests/render/test_geometry.py
ffacef145c2b4519e63378dbba81353e5950de1f9e3548684781ecc83b50bfba  tests/render/test_legend.py
f3f8a27a2667ae3854e948165fc69500e4266e834fed594b5045a74b38b13a31  tests/render/test_panel.py
e94575c8344597aac19b37a073901e089a3abac08bc46704c442560f2ed25dc8  tests/render/test_svg_extras.py
4e09f757649797706204dabff1e8c320d898d14c626ab0515b5f611d91760e4d  tests/render/test_svg.py
3f9b63ec3197844460a5b829beacd94b267cb0e58f16375ff9cfd829275935d9  tests/render/test_timeline.py
0e8c250507117e5614d9d815f4a23c1ae9954a871ea758205fd3989eb0c4e978  tests/signalling/test_approach.py
f47e51e8c0629e2193802a4c5ee15d27806d9e6ace4c9531a95f3981009b9ee6  tests/signalling/test_aspects.py
d866c61e63d3fd19a3f885659c74e1f03ba4f8a82e9d69333ac7f9f70ae1266d  tests/signalling/test_berth.py
bfef8cb550431549251aeb5e56ae81dbca93d345288b951ab236ed350afff8f6  tests/signalling/test_callon.py
1bf4f99663d6a238d37412bb2448f081b0844641a6c7b6b19cb7ea93d8ea5f4e  tests/signalling/test_conflict.py
f438132d230e8b895fdad7d50659b048c3694b290d7fa9b7136aba5b8062c844  tests/signalling/test_crossing.py
478fc5e43082b5bba76c4395e18f2e5831322305275fd6d4f13ea48b4fa094f0  tests/signalling/test_emergency.py
69b99ccd14d638fa3e09df09d65857859570a7ed14a4c5789986d195f397c838  tests/signalling/test_flank.py
e7a64033764708c186777b5b695b7f0f3620d81221595587167f56ced6f8edfa  tests/signalling/test_flank_traps.py
f6bd1b392ab146540feb0ba5649d39decea0d5bdd30dc5240f6e0046417c16a9  tests/signalling/test_headway.py
dd5501a5ebe7450a743ec95125240cc688017fd5c05fd407ed16a6ba9af603a3  tests/signalling/test_interlocking.py
2928e9d51dec72a6e46b557ebdd0758d3612804f35a6c73c8510391a0e2ff6ab  tests/signalling/test_locking.py
0f00355d7e3e9dabdca6516e2fc55606555983ad98bd2f823518fb77bc5a9a40  tests/signalling/test_overlap.py
2e19c4ffc48dad609c3aea2ee510a2e40da40fe0a33490b8b61d4cce7e70be34  tests/signalling/test_points.py
a7f2b74c006acdad1c9358be1d9d3688e741ac35a27bd8b60af87674186e7bc9  tests/signalling/test_profile_helpers.py
ea9b74501a1fe992816343490638ef63c733495337cf8660452edc7a8789fd55  tests/signalling/test_routefind.py
86310ad13c31d72d87cb3da8228540f66e93808419bf309a497b8dd5a7b68c85  tests/signalling/test_sighting.py
cd62a4208abe917b7491f7e8ddf04c79eae66683ddc155e8a48972af82d85105  tests/signalling/test_subroute.py
d87aa74520590a30fc60e97e8e8bcd7602d72106b93c1952e281598e2cd2897c  tests/signalling/test_tpws.py
418af14a615cd1a6873490c41e1fc275623278eaaba6c5380259ded04f897f34  tests/signalling/test_trap.py
1448658dea560052fb181331404a1404d828d8b5a1e576841b578cdc596d3967  tests/signalling/test_warning.py
1548d1f0404890d3a7265b7221d27f07c76fd8b6f6ae2cfd83488cbaa242609b  tests/sim/test_ars.py
9c3494346098ce760e88c6853922b08e4f12a4095e86ad75a5eeb45a582a42f5  tests/sim/test_driver.py
4dbeec84d6f457bcc912551312f2487237d28976b3ae5ef65e39271679e39c79  tests/sim/test_history.py
06514e0f6ace4a614aea31cd0847db691213b352b00a6954ff1c8c9d522ffb67  tests/sim/test_lamp_failures.py
95aa8ab73f1930e3f1bec634f0dc160223134fdede39c1eb221ab52e6ebdc326  tests/sim/test_lamps.py
5a56bacaf6fbd2bc76e6072be1b21423e74c357dcaa968f1f79d4077f4186607  tests/sim/test_leaving.py
b013f2ca110dd26c22b1697e83ad5c1e940f5c7898d42e543eecee751c2a516c  tests/sim/test_log.py
49743f593c208a9d76b92f531df5001cc315b506e5924845965a0f3cf75ff860  tests/sim/test_machine_failures.py
4f3ee4756f877306c38d6ae520ae75ade1d7c9c1955885b10ecf5903c2941211  tests/sim/test_machine_points.py
363b0465b1ca5e43ef0c0b0188278d7340911110d9f0b877d458f579587760df  tests/sim/test_machine.py
56915b15f60a1b5f1125522031e0110c812768762bb51cffd384424f2152934b  tests/sim/test_regulator.py
46493792c897c957bf317708c02710a06e33530e10cb676742e5ff9a2d28465a  tests/sim/test_replay.py
2f8124275b08d0575ebdf6c51d4ceb1bc110e20a963749a2168c0721f3690f38  tests/sim/test_reversal.py
f5d5b00d63ccc338696f7f302683b98473f9ad6731405def691086145f81b6b7  tests/sim/test_scenario_booking.py
26726f383b739166e10c653f12933db972a38a859539052f348d566e3ceeeba1  tests/sim/test_scenario_dispatch.py
88397014deae849d7ab965847b3f7f6064c9f3713b062db00af4a94e575e1c5a  tests/sim/test_scenario_failures.py
f49963e9e29b02a31f99a354ecb01aeddf98535fdd1fa1daa206146d25e91111  tests/sim/test_scenario.py
89f76e9f68f6d6b3d26b32bd1a9aa128b42d97bc09436632eb1a9d842993ad13  tests/sim/test_scenario_reader.py
496ae4c01c150292fe41ea584c850057d85ae92e3429cdd08600ccc7355974cd  tests/sim/test_scenario_times.py
bd2df7d60bf33ebceda05d4e41e139cb8fe9e5a305d010f437b7d767c62c2fe6  tests/sim/test_state.py
ff807f18bfb1079f2b20e9a49bff08137ae4c497089ccf00e765b009eabba90a  tests/sim/test_timetable.py
b485f8532b7cf6a346c7b596d833d8f9f794779002be1f3abaad1d4cd0294ca4  tests/sim/test_track_failures.py
c31260a7790e216136b7c5a49e25ee3f790538b3e8a5c499e8decaab4cc94e39  tests/sim/test_train.py
b7e05521a49af68e794111454e3dbda5d8047aba7bef365234b625231874d775  tests/sim/test_world.py
4a931eb6a38e6d2009d019ab44b9ac41a92f8654d607c864087579210e9665ad  tests/tables/test_aspect_table.py
f08928a0fe5a785112b0be8e63134831f060dadb005cda573b48b8a370d6460d  tests/tables/test_control_table_crossings.py
982c379588e844c581c040f245f7471c84f424d107d2f0982f057200b77f5933  tests/tables/test_control_table.py
a0df99b0ef8faecb7c3cf6302eb1658324ff82cb145ae72372ef3e368e3f91ae  tests/tables/test_diff.py
b8a6a161ac074da2973e7194b3fe0a9793b0d1b29c61acc3df00d5435dcbf40f  tests/tables/test_index.py
2dbf718d5b4181478a2dafa7896500db04597cb42266e3884b1a8a1f0db7f6d3  tests/tables/test_locking_table.py
d62a8bd83cf224410af0dfdc9029aa31ecbe68cf75fee2df504cd815f291968d  tests/tables/test_points_table.py
5b482417b2e104d18d823300e24259e11f907c0b2f32df8a759cf3f65815faaa  tests/tables/test_render_columns.py
a01159bbf41aad59dcae6401208979542c26d5fb03cfe6eaf6a016ef9072e12c  tests/tables/test_render.py
08315911e48a735f1ade7fc0719ff3c71fa70ba5cc820726643eebf016570221  tests/tables/test_sorting.py
6bc39c5982a4082c239b0b95336319aeb766461044fdaa119a7abd06f369e53b  tests/test_api.py
ef7ae18085f57534430b1121d4a63e2a4d0df55da090bbc9b81ff48d98b9ad2d  tests/test_design_doc.py
461ee1abe8522826b12fbf37f23c0ce362f371b58bae410ce34b24db8c200204  tests/test_docs.py
193d495d2f667a51dee668a955198e4144b78b48456841fb0bc01d3c72162afe  tests/test_example_scenarios.py
d7cb06dad63107db1ea5bab5ccf2cb519ab30bc44d528d27f596ec99ddd0ce8b  tests/test_examples.py
7bdf354507ca42193bd861d5ffee01b4e8ff3e0a74ce8b034eb4f509182dc907  tests/test_golden.py
7d1ec57617465ecfe2c5a56dba2126bab0b042bedee02ac578c645fb85d62634  tests/test_packaging.py
f07ab34e76b6026b761429f59d070bc87cf57996ed61d35fec21bcba98ca61af  tests/test_performance.py
79c2eae04180a271db087e9497a2ec0d329745b165fec2e553ec69abb7991f40  tests/test_readme.py
5e20466c73265ac8f6e2dc24952aea335f1eeccf438832a5b89d50f6f73de240  tests/test_rules_doc.py
4bd2523742c14e0a3776ab91799268d3dbf52fdcca9a20bfdb613874b63c7fe8  tests/test_scenario_docs.py
ce5de7b84654f0e59bfaf197d039dda4ae594559b44a56dfad762c85c322c632  tests/test_terminus.py
0fe0c3759ae89036764cfcbd0663ed2309e835093e994b23b2f61bd45dd28636  tests/unit/test_ast.py
53ecd666b03cf4dffd27d13f7c5ec0d949335181126d67229c7c0cc98e43c1b8  tests/unit/test_braking.py
1485cf2099b2aec29a0b74675e36b19f76fa3619046bae3540c490098c358dcd  tests/unit/test_chainage.py
9a908c786f2d04f7ff815f73c0b1f00a340bfedd76db371726835ccacffb7dd9  tests/unit/test_context.py
572776311bfc24e10804d13956582979cc4e5a3c7aa3fbbdf4db4fb74abeef84  tests/unit/test_crossing_decl.py
33773e0cc4f594397bf90eee40ff689013bad037fa2652300801787ea0c12ebd  tests/unit/test_cursor.py
4aaf7c49bbbf537a5d16586523fab3f1f7b6e39b236b436c592d9ca9ee9467b2  tests/unit/test_format.py
cd08bb3563b010cebc62529641df6d305e32e80c7ececcbfbc4b7ce0c8119989  tests/unit/test_graph.py
57b1ad016b407eb0f2af6debf749cfc26c5b7903b5314a043a6a3fc5bcee4828  tests/unit/test_include.py
7a03eba55548671ca970ef9514026b4931a18037a086eac35fc52973948c0c6f  tests/unit/test_measure.py
20ab3d53faebdc3345b21fa2f3a310ab485f7504b732dbe508e5a28178b2e70d  tests/unit/test_parser.py
4894d386031eb68233221112fdb25568ebfda7faa187ebe4703888b019beb4f3  tests/unit/test_position.py
9ec5e2e793861cfa18bbaad5d889209bb99a88e4dc9e8a419d35ffcb7652fd20  tests/unit/test_profile.py
d68dee9751f98eddbd45d7d6c8a8f1fbebdcf9663422a40406f81f72342d72ec  tests/unit/test_reachability.py
2be2ba85360e04b52baaa677e5f69e4c4b162235cedf7b0884205d52eac1bbd5  tests/unit/test_route.py
22f406b3566683ac520e69e29fe3f5715e043bbdb7365895221ea9b55b0839f6  tests/unit/test_scheme.py
734dadcadb7319fdb8fd07634eff82480b127e29972e832648d8c8197460ae44  tests/unit/test_section.py
279f83948ed661640ab229b34a832ed6b2de2f67e0267bc9bc4f6b72f4746f0a  tests/unit/test_signal.py
59f8d3cad84252b17564acc0f6d04c22d86e599f08e2e56f8ebc457eedb81086  tests/unit/test_slip_interlocking.py
f6f8e896dda9c150833d946d403a1cc5e66aa8f0529645ace8966aa586e792de  tests/unit/test_slip.py
6afd5a9e57208bd09ab04c2bf3974eb39b8df40dd3af8445319a2b187f5cc238  tests/unit/test_standards.py
efd92c54eb54236df01396332495526052ba35f25a6f22ec911c47b284d43cd5  tests/unit/test_tokens.py
0b0205376c89a9b22d0734d8a134f9a6d44662de43bb19379e6e25258afbca08  tests/unit/test_traverse.py
eb7b5d11ca8997cf04a9ec93b333e95d2fa636acffb0d83095fe4596815390ea  tests/unit/test_units.py
d92823397bc8813de0765f05c1b6bddf8bebdc95ce194cce1b8e29b6ee4e628e  tests/unit/test_validate.py
7ce6aabbc4706dca5b615c86010940517718c49aa6c42e2bdc58307af4afff18  tests/unit/test_walk.py
8668f7c831766312255dec32f1d6e52f0c126984c01a4a4e0f0efe54c70800ad  tests/verify/test_check_aspect.py
fe2e7758c4d989c277e50508ed000c3198958676b525526471ac50aafd0d2bd0  tests/verify/test_check_capacity.py
f86fbba1b829f4130161d83d7c0a81bc06a9efddccaa7fc1681e266fdf8ca531  tests/verify/test_check_crossing.py
de5e08627701dc3f0a58afa10ce7974cc1b5e31f0a3ea49302044e8c0bf785dc  tests/verify/test_check_detection.py
b7a7ff837face591203c7b669ab4b851536c8733a16c59335a1a6f99eb0c7657  tests/verify/test_check_flank.py
fbd25b3ef8dd2b75434521276779ac74854df1895dcccfd63e1895de7b769d5b  tests/verify/test_check_gradient.py
c0613994b03852c6eb1a565b8bc9562bc88f725f73c70e8cd249e3d904cb93a5  tests/verify/test_check_layout.py
80170f0063e7c0be10abc8e69411f70ad17a2d3fe92b9c2ec523824011eb9982  tests/verify/test_check_locking.py
079c44be339109e735557a370ec950308e59107bfd3893fd26d56b2707aa141b  tests/verify/test_check_overlap.py
f89e39f7eabeea412d56af543dfffd8b1e704fc75191ba92467a898ad4060616  tests/verify/test_check_points.py
c8b1baf6cb2fabbd8a3dae0aac7fb03e350bf23e741eb54c3bdeee3c0a8be168  tests/verify/test_check_protection.py
58e6503b271d9054c43db624390cf1869ec8d0ae1a41de2db318063a3a57fd9a  tests/verify/test_check_reversible.py
6a687a0b836b925d103eea5958e2872bde53d2c63249c0b8d6a9e7f09c9329bb  tests/verify/test_check_route.py
d28f01d637b6f560975ed79987c923d79b6f37765d8a6cadfe36428360476c8f  tests/verify/test_check_setting.py
65137c55dc1dff0774d1092c5686cadabb5ef04425a2fd2f5a6c8ed14f728574  tests/verify/test_check_sighting.py
5d35a0ed517175cefd484fb637e01eb360a1e6f1dee7efce761a9a6da08b6f93  tests/verify/test_check_spacing.py
1dad0d9e1815b0cb263b53a6af4ea0387eb07588d3da5a493e5d4b0d86149a03  tests/verify/test_check_standards.py
7574366a2b82f59cd2d0ed739c08befca0079c89ae39239d02a3ff29458b929a  tests/verify/test_guidance.py
0132ee3deda19b3dd7293fb9dd301510bf0d7529cc13929275f4aff25b28adc0  tests/verify/test_report_extras.py
d4ee8769f5c09206b52837ffb89285487eaab5d6fe27fda5c14f252676e75e0d  tests/verify/test_rules.py
04ae6bbd05568498ba6e3ea71636fcfd141316a2914a9f7952626d88547c2612  tests/verify/test_standards_are_used.py
b28b7f9441d260cee4b0c736a759b0ff377c853c38477a6438b9583445d04c98  tests/verify/test_waivers.py
edb9644a046676631c8c185d34ffc6f8895d611dfb33689a546107af9f5841cb  tests/conftest.py
8866462b9d615f1cf78f87bcc3964411b48ce3f33af7606ee66197b830a34b32  examples/ashcombe.sbx
219e5bda22a928b753085a7e6ab99ec283234d164aae090ec8a312bec366d31f  examples/ferrybridge-quay.sbx
0239e8397e3cfac929a6e35dce76e1111ea0c6da4723d984f98d4345bffe4e5b  examples/scenarios/ashcombe-both-ways.sbs
fa78e129bade6299878f56c2d3ceabf2eb78c4676edc963042e4079a7339cb6d  examples/scenarios/kingsmoor-branch.sbs
a66df5047d3d2ff0b9476dc6573bde9692ddc2f7975f35713722013f7660c614  tests/data/booked-through.sbs
b5dddf511a1f7e6dab2bafc2fc34c2d1ad67a5676a5195c531e7f183b9710a38  tests/data/down-through-the-junction.sbs
c5670a6133e9f1db8e82d9cc2c7533cfb0852862ce8bdd5583e98221a210bd21  tests/data/hallowgate-warning.sbx
6ed48de830f22a592f3a8bcb976f1ad8e6343090697ffd519fab577f2b4df7ea  tests/data/kingsmoor.sbx
1dfe54ce20788c2bc05d274f84e6890ddfbd3750005e3d3d968ea01a35d9e652  tests/data/marlow-crossing.sbx
3330a7a6747d82170e71d0f1cd279563cd86319b535bd15916aa0d018837f89d  tests/data/netherby-mileage.sbx
8316ad64f4060a7043bfa5c0611607165881c7315e6d2f4193e2fa7a30b3701a  tests/data/points-failure.sbs
7b25f0267e16ec66ae654dc7d0e027917dc320b591e6e4796054da835fae4e5d  tests/data/split/area.sbx
2c38b03ddfde674aeb7936565d4f991c1634cf7a0d3529cab425f2acfd8a5b64  tests/data/split/scheme.sbx
407937052bd176b97466e6001e4c9ae61215c2467a5a878b5e2de79f38223e5d  tests/data/thornley-platform.sbx
SHA_P2P
)
NEW_SHA=$(cat <<'SHA_NEW'
bca660c38879cbb3943320f5e224295d09fed627efbbed08950c6700b6b50980  tests/unit/test_reset_grouping.py
135f6c1199c611caa29260b789c5b5ed5bb82835c1fa1298c394c59235149b21  tests/tables/test_head_listing.py
SHA_NEW
)

# Every conftest.py goes, along with stale bytecode; tests/conftest.py is then
# restored from the base commit and digest-checked, and the repository root
# one stays gone: it prepends /app to sys.path, which is the one thing the
# child is careful not to do. -c above already pins configuration to the
# verifier's own ini. HEAD in this container is the base commit; model.patch
# and test.patch touch the working tree only.
clean_tree() {
  find /app -name 'conftest.py' -delete 2>/dev/null || true
  find /app -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
  find /app -name '*.pyc' -delete 2>/dev/null || true
  for f in $P2P_FILES $SUPPORT_FILES; do
    git -C /app checkout HEAD -- "$f" 2>/dev/null || true
  done
}
p2p_matches() { printf '%s\n' "$P2P_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
new_matches() { printf '%s\n' "$NEW_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
log_mismatch() { printf '%s\n' "$1" | (cd /app && sha256sum -c - 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true; }

clean_tree
P2P_OK=1
if ! p2p_matches; then
  P2P_OK=0
  log "ERROR: pass-to-pass sources (or the fixture module) do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
  log_mismatch "$P2P_SHA"
fi
NEW_OK=1
if new_matches; then
  # Keep a root-only copy of the held-back modules as shipped, to restore
  # from before their suite runs.
  for f in $NEW_FILES; do
    mkdir -p "$KEEP/$(dirname "$f")" 2>/dev/null || true
    cp "/app/$f" "$KEEP/$f" 2>/dev/null || true
  done
else
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
  log_mismatch "$NEW_SHA"
fi

# Everything the verifier runs is now in place: make it read only to anyone
# but root, so the unprivileged child cannot rewrite its own script, the
# kept copies, or a report.
chmod 0444 "$VDIR/pytest.ini" 2>/dev/null || true
chmod -R go-rwx "$KEEP" 2>/dev/null || true
chmod 0700 "$RPTDIR" "$KEEP" 2>/dev/null || true
chmod 0555 "$VDIR" 2>/dev/null || true

# Process snapshot before the suites, for the sweeps.
proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)

# Sweep: end anything that appeared since the snapshot and is still running,
# so no process spawned by code under test survives into the next suite or
# into grading. The chain of this script's own ancestors is exempt.
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

# Between the suites: nothing from the first may still be running, and
# everything the second reads is put back and checked again. Code that ran
# inside the first suite had /app open; the held-back modules come back from
# the root-only copies and the fixture module from the base commit, and both
# are digest-checked against the digests this shell already holds. A
# mismatch that survives the restore refuses the suite.
sweep
if [ "$NEW_OK" = 1 ]; then
  clean_tree
  for f in $NEW_FILES; do
    cp "$KEEP/$f" "/app/$f" 2>/dev/null || true
  done
  if ! new_matches; then
    NEW_OK=0
    log "ERROR: held-back test sources were altered during the pass-to-pass suite and could not be restored; their suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$NEW_SHA"
  elif ! p2p_matches; then
    NEW_OK=0
    log "ERROR: the fixture module or pass-to-pass sources were altered during their suite and could not be restored; the held-back suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$P2P_SHA"
  else
    echo "+ held-back modules and fixture module re-checked before their suite: OK" >> "$RUN_LOG" 2>/dev/null || true
  fi
fi
if [ "$NEW_OK" = 1 ]; then
  # every held-back file is digest-pinned above; only the test modules run
  NEW_RUN=""
  for _f in $NEW_FILES; do case "${_f##*/}" in test_*.py) NEW_RUN="$NEW_RUN $_f" ;; esac; done
  run_suite "$RPTDIR/new.xml" $NEW_RUN
fi
sweep

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
