import subprocess, sys, xml.etree.ElementTree as ET, os, pathlib, json

P2P_FILES = """tests/cli/test_cli.py tests/contract/test_public_api.py tests/end_to_end/test_import.py tests/integration/test_compile_examples.py tests/integration/test_invalid_fixtures.py tests/integration/test_rehearse.py tests/integration/test_split_show.py tests/integration/test_store.py tests/integration/test_unknown_intervention.py tests/integration/test_workspace.py tests/property/test_invariants.py tests/unit/test_assertions.py tests/unit/test_builders.py tests/unit/test_canonical.py tests/unit/test_clock.py tests/unit/test_compiler_errors.py tests/unit/test_events.py tests/unit/test_evidence.py tests/unit/test_findings.py tests/unit/test_geometry.py tests/unit/test_graph.py tests/unit/test_identifiers.py tests/unit/test_loaders.py tests/unit/test_presentation.py tests/unit/test_reservations.py tests/unit/test_result.py tests/unit/test_schedule.py tests/unit/test_sheets.py tests/unit/test_state.py tests/unit/test_time.py tests/unit/test_trace.py tests/unit/test_yaml_on_key.py""".split()

NEW_FILES = ["tests/integration/test_performer_continuity.py", "tests/integration/test_rehearsal_marks.py"]

def run(files, xml):
    code = (
        "import sys\n"
        "sys.path.append('/app/src'); sys.path.append('/app')\n"
        "import pytest\n"
        "raise SystemExit(pytest.main(['-q','-p','no:cacheprovider','-c','/verify/pytest.ini','--rootdir=/app','--junitxml=%s'] + %r))\n"
    ) % (xml, ["/app/" + f for f in files])
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    r = subprocess.run([sys.executable, "-I", "-c", code], env=env, cwd="/verify",
                       capture_output=True, text=True)
    print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-200:])
    return r.returncode

def ids_of(xml):
    root = ET.parse(xml).getroot()
    return [tc.get("classname") + "." + tc.get("name") for tc in root.iter("testcase")]

pathlib.Path("/verify").mkdir(exist_ok=True)
pathlib.Path("/verify/pytest.ini").write_text("[pytest]\naddopts =\n")
pathlib.Path("/logs/verifier").mkdir(parents=True, exist_ok=True)

run(P2P_FILES, "/logs/verifier/base.xml")
p2p = ids_of("/logs/verifier/base.xml")
print("p2p:", len(p2p), "unique:", len(set(p2p)))

mode = sys.argv[1] if len(sys.argv) > 1 else "base"
out = {"p2p": p2p}
if mode == "solution":
    run(NEW_FILES, "/logs/verifier/new.xml")
    f2p = ids_of("/logs/verifier/new.xml")
    print("f2p:", len(f2p), "unique:", len(set(f2p)))
    out["f2p"] = f2p
pathlib.Path("/out/ids.json").write_text(json.dumps(out, indent=1))
