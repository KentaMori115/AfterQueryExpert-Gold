#!/bin/bash
# Attack matrix against the verifier, every attack row on the BASE tree (where
# the f2p cases genuinely fail), each checked for ids-present as well as
# reward. A defended attack leaves reward 0 with all 48 f2p ids and all 491
# p2p ids published; a successful fabrication shows reward 1 or fewer ids.
# Honest rows (solution, a solution bringing its own test file, a solution
# that appended to an existing test) must score 1.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
BUNDLE="$TASK"
WORKDIR="$TASK/../../work-window"
IMG=slateql-env:v1

# The bundle's config.json carries the platform base sha; the local image is
# HEAD of the work repo's main, so the local runs use a scratch copy of tests/
# with that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(docker run --rm "$IMG" git -C /app rev-parse HEAD)
TESTS_LOCAL=$(mktemp -d)
cp -r "$BUNDLE/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["base_commit"] = sha; json.dump(d, open(p, "w"), indent=1)
PYSUB
# The real verifier image gets /tests from COPY, so it is world readable there.
# mktemp -d is 0700, which would make the local runs kinder than the real one.
F2P=104
P2P=491

run_row() {
  local name="$1" setup="$2" with_solution="${3:-no}" expect="${4:-0}"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ "$with_solution" = yes ]; then
    cp "$BUNDLE/solution/solution.patch" "$logs/artifacts/model.patch"
  fi
  # A fresh copy per row, mounted writable and world readable, because that is
  # what COPY into the verifier image produces; test.sh locks it down itself.
  local tl
  tl=$(mktemp -d)
  cp -r "$TESTS_LOCAL/." "$tl/"
  chmod 0755 "$tl"; chmod 0644 "$tl"/*
  docker run --rm \
    -v "$tl:/tests" \
    -v "$HERE/attacks:/attacks:ro" \
    -v "$logs:/logs" \
    -e SETUP="$setup" \
    "$IMG" bash -c 'eval "$SETUP"; bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  python3 - "$name" "$logs" "$expect" "$F2P" "$P2P" <<'PY'
import json, sys, pathlib, xml.etree.ElementTree as ET
name, logs, expect, F2P, P2P = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
rj = logs/"verifier"/"reward.json"
reward = "NONE"; f2p_present = 0; p2p_present = 0
if rj.exists():
    reward = json.loads(rj.read_text()).get("reward")
for xmlname, bucket in (("base.xml","p2p"),("new.xml","f2p")):
    f = logs/"verifier"/"reports"/xmlname
    if not f.exists(): f = logs/"verifier"/xmlname
    if f.exists():
        n = sum(1 for _ in ET.parse(f).getroot().iter("testcase"))
        if bucket=="f2p": f2p_present = n
        else: p2p_present = n
ok = (reward == expect and f2p_present == F2P and p2p_present == P2P)
verdict = ("OK" if expect == 1 else "DEFENDED") if ok else "*** BREACH / FAULT ***"
why = ""
log = logs/"verifier"/"run.log"
if log.exists():
    for line in log.read_text(errors="replace").splitlines():
        if "[publish]" in line and ("refused" in line or "declared ids added" in line and "(0 declared" not in line):
            why = line.strip()[:110]; break
        if "[runner] framework tampered" in line:
            why = line.strip()[:110]; break
print(f"{name:32s} reward={reward} f2p_ids={f2p_present} p2p_ids={p2p_present}  {verdict}  {why}")
PY
}

echo "== honest rows =="
run_row "honest_base" "true" no 0
run_row "honest_solution" "true" yes 1
run_row "solution_plus_own_test_file" \
  'printf "import slateql\n\ndef test_mine():\n    assert slateql.__version__\n" > /app/tests/test_mine.py' yes 1
run_row "solution_edits_existing_test" \
  'printf "\n\ndef test_appended():\n    assert True\n" >> /app/tests/test_util.py' yes 1

echo "== attacks on the base tree =="
run_row "root_conftest_forge" \
  'printf "def pytest_runtest_logreport(report):\n    report.outcome=\"passed\"\n" > /app/conftest.py'
run_row "tests_conftest_forge" \
  'printf "\ndef pytest_runtest_logreport(report):\n    report.outcome=\"passed\"\n" >> /app/tests/conftest.py'
run_row "extra_conftest_planted" \
  'printf "def pytest_runtest_logreport(report):\n    report.outcome=\"passed\"\n" > /app/tests/../conftest_extra.py; cp /attacks/reports_forge.py /app/slateql/conftest.py'
run_row "sitecustomize_in_app" 'cp /attacks/reports_forge.py /app/sitecustomize.py'
run_row "usercustomize_in_app" 'cp /attacks/reports_forge.py /app/usercustomize.py'
run_row "shadow_pytest_in_app" \
  'printf "def main(*a, **k):\n    return 0\n" > /app/pytest.py'
run_row "package_patches_reports" 'cat /attacks/reports_forge.py >> /app/slateql/__init__.py'
run_row "package_outcome_property" 'cat /attacks/outcome_property.py >> /app/slateql/__init__.py'
run_row "package_runtest_noop" 'cat /attacks/runtest_noop.py >> /app/slateql/__init__.py'
run_row "package_rebinds_os_write" 'cat /attacks/os_write_rebound.py >> /app/slateql/__init__.py'
run_row "package_wraps_pluggy" 'cat /attacks/pluggy_wrapped.py >> /app/slateql/__init__.py'
run_row "rewrite_p2p_file" \
  'printf "def test_util_smoke():\n    assert True\n" > /app/tests/test_util.py'
run_row "rewrite_shared_conftest" \
  'printf "import pytest\n" > /app/tests/conftest.py'
run_row "tamper_with_sample_data" \
  'printf "id,name,city\n" > /app/data/customers.csv'
run_row "rewrite_held_out" \
  'echo "x=1" > /app/tests/test_ranked_events.py; echo "x=1" > /app/tests/test_depot_sales.py'
run_row "stale_pyc_planted" \
  'python3 -c "import py_compile; py_compile.compile(\"/app/slateql/__init__.py\", cfile=\"/app/slateql/__pycache__/__init__.cpython-312.pyc\")"; true'
run_row "fork_continues_session" 'cat /attacks/fork_continues.py >> /app/slateql/__init__.py'
run_row "lingering_rewrites_reward" 'cat /attacks/lingering.py >> /app/slateql/__init__.py'
run_row "atexit_rewrites_xml" 'cat /attacks/atexit_xml.py >> /app/slateql/__init__.py'

# Three forges written against this runner in particular, in increasing order
# of knowledge: the first hunts the token as a string in a frame, the second
# the byte prefix the recorder writes with, the third the recorder object
# itself through the collector. All three have to reproduce the declared id
# set exactly, which is why they are refused; see STATUS.md for what that does
# and does not prove.
echo "== forges written against this runner =="
run_row "forge_token_from_frames" 'cat /attacks/residual_gc_forge.py >> /app/slateql/__init__.py'
run_row "forge_prefix_from_bytes" 'cat /attacks/residual_prefix_forge.py >> /app/slateql/__init__.py'
run_row "forge_via_recorder_object" 'cat /attacks/probe_recorder_forge.py >> /app/slateql/__init__.py' 
