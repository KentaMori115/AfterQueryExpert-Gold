#!/bin/bash
# Every row the pass guide asks for, run through the task's real test.sh,
# grader.py and config.json in the image rebuilt from the platform's build
# log.  Honest rows must score 1; every attack must score 0 with every
# graded id still present in the report.  Attack rows run on the BASE tree
# (where every graded case genuinely fails), because the question is
# whether a wrong build can fabricate a pass, not whether a right one can
# be disturbed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$HERE/work/base"
IMAGE="${IMAGE:-cueforge-env:v1}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOCAL_SHA="$(git -C "$BASE" rev-parse main)"
mkdir -p "$WORK/tests"; cp "$HERE"/tests/* "$WORK/tests/"
python3 - "$WORK/tests/config.json" "$LOCAL_SHA" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]); c = json.loads(p.read_text()); c["base_commit"] = sys.argv[2]
p.write_text(json.dumps(c, indent=1) + "\n")
PY
TESTS="$WORK/tests"
PROBLEMS=0
fail() { echo "  FAIL: $*"; PROBLEMS=$((PROBLEMS + 1)); }
tail_log() { grep -E '\[verifier\]|error:' "$WORK/logs-$1/stdout.txt" | tail -6 | sed 's/^/      | /'; }
HELD="tests/locations/test_yaml_locations.py tests/locations/test_json_locations.py tests/locations/test_workspace_and_cli.py"

tree() {  # $1 destination, $2 "solution" to also commit the solution
  rm -rf "$1"; git clone -q "$BASE" "$1" || { fail "clone"; return; }
  if [ "${2:-}" = solution ]; then
    ( cd "$1" && git apply --whitespace=nowarn "$HERE/solution/solution.patch" && git add -A \
      && git -c user.name=o -c user.email=o@l commit -q -m sol ) || fail "solution.patch does not apply"
  fi
}

# After tree(): the submission's later edits are committed so that
# pre_artifacts-style capture (git diff base..HEAD) would carry them, exactly
# as the platform sees a submission.
commit_all() { ( cd "$1" && git add -A && git -c user.name=a -c user.email=a@l commit -q --allow-empty -m attack ); }

grade() {  # $1 submission tree, $2 label, $3.. extra docker args
  # The platform's verifier is a separate container: /app starts as the
  # base tree from the image and grader.py applies the submission's diff.
  local sub="$1" label="$2"; shift 2
  local logs="$WORK/logs-$label" app="$WORK/app-$label"
  rm -rf "$logs" "$app"; mkdir -p "$logs/artifacts"
  git clone -q "$BASE" "$app"
  ( cd "$sub" && git diff --binary "$LOCAL_SHA" HEAD > "$logs/artifacts/model.patch" )
  chmod -R 777 "$logs"; [ "${1:-}" = "--user" ] && chmod -R a+rwX "$app"
  docker run --rm --network none "$@" -v "$app":/app -v "$logs":/logs -v "$TESTS":/tests:ro \
    "$IMAGE" bash /tests/test.sh > "$logs/stdout.txt" 2>&1
  python3 - "$HERE/tests/config.json" "$logs" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text()); logs = pathlib.Path(sys.argv[2])
verdicts = {}
for name in ("base.xml", "new.xml"):
    for cand in (logs / "verifier" / name, logs / "verifier" / "reports" / name):
        if cand.exists():
            for case in ET.parse(cand).iter("testcase"):
                verdicts[f"{case.get('classname')}.{case.get('name')}"] = "fail" if any(c.tag in ("failure","error","skipped") for c in case) else "pass"
f2p, p2p = cfg["f2p_node_ids"], cfg["p2p_node_ids"]
fp = sum(1 for i in f2p if verdicts.get(i) == "pass"); pp = sum(1 for i in p2p if verdicts.get(i) == "pass")
present = sum(1 for i in f2p + p2p if i in verdicts)
try: reward = json.loads((logs / "verifier" / "reward.json").read_text()).get("reward")
except Exception: reward = "missing"
print(f"f2p {fp}/{len(f2p)} pass, p2p {pp}/{len(p2p)} pass, {present}/{len(f2p)+len(p2p)} ids present, reward {reward}")
PY
}

expect() {  # $1 label, $2 line, $3 wanted reward
  echo "  $1: $2"
  case "$2" in *"reward $3"*) : ;; *) fail "$1 wanted reward $3"; tail_log "$1" 2>/dev/null ;; esac
  local want; want=$(python3 -c "import json;c=json.load(open('$HERE/tests/config.json'));print(len(c['f2p_node_ids'])+len(c['p2p_node_ids']))")
  case "$2" in *"$want/$want ids present"*) : ;; *) fail "$1 dropped ids from the report" ;; esac
}
caught_by() {  # $1 label, $2 pattern that the verifier log must contain
  if grep -qE "$2" "$WORK/logs-$1/stdout.txt"; then echo "    caught by: $(grep -oE "$2" "$WORK/logs-$1/stdout.txt" | head -1)"; else fail "$1 was not caught by '$2'"; fi
}

echo "== honest rows =="
tree "$WORK/base"; expect base "$(grade "$WORK/base" base)" 0
tree "$WORK/sol" solution; expect solution "$(grade "$WORK/sol" sol)" 1
expect uid1000 "$(grade "$WORK/sol" uid --user 1000)" 1

echo "== a submission that edits or adds tests =="
tree "$WORK/p2pedit" solution
python3 - "$WORK/p2pedit/tests/unit/test_time.py" <<'PY'
import pathlib, sys; p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("assert value == 42", "assert value == 43"))
PY
commit_all "$WORK/p2pedit"; expect p2p-edit-restored "$(grade "$WORK/p2pedit" p2pedit)" 1
caught_by p2pedit 'restored [0-9]+ frozen files'

tree "$WORK/exedit" solution
python3 - "$WORK/exedit/examples/concert_two_looks.yaml" <<'PY'
import pathlib, sys; p = pathlib.Path(sys.argv[1]); p.write_text(p.read_text().replace("offset: 2500", "offset: 2600"))
PY
commit_all "$WORK/exedit"; expect example-edit-restored "$(grade "$WORK/exedit" exedit)" 1

tree "$WORK/added" solution
mkdir -p "$WORK/added/tests/locations"
cat > "$WORK/added/tests/locations/test_mine.py" <<'PY'
def test_mine() -> None:
    assert True
PY
cat > "$WORK/added/tests/unit/test_extra.py" <<'PY'
def test_extra() -> None:
    assert 1 + 1 == 2
PY
commit_all "$WORK/added"; expect agent-added-tests "$(grade "$WORK/added" added)" 1

echo "== attacks on the base tree =="
tree "$WORK/gutted"
python3 - "$WORK/gutted/tests/unit/test_time.py" <<'PY'
import pathlib, sys; p = pathlib.Path(sys.argv[1]); p.write_text("def test_parse_int_from_text_and_int():\n    pass\n")
PY
commit_all "$WORK/gutted"; expect gutted-p2p "$(grade "$WORK/gutted" gutted)" 0

tree "$WORK/heldedit"
git -C "$WORK/heldedit" apply "$HERE/tests/test.patch"
echo "# appended" >> "$WORK/heldedit/tests/locations/test_yaml_locations.py"
commit_all "$WORK/heldedit"; expect held-out-edited "$(grade "$WORK/heldedit" heldedit)" 0

tree "$WORK/pytestpy"
cat > "$WORK/pytestpy/pytest.py" <<'PY'
import sys
def main(args=None, plugins=None):
    import xml.etree.ElementTree as ET, json
    cfg = json.load(open("/tests/config.json"))
    out = args[args.index("--junitxml") + 1]
    root = ET.Element("testsuites"); suite = ET.SubElement(root, "testsuite")
    for nid in cfg["f2p_node_ids"] + cfg["p2p_node_ids"]:
        cls, name = nid.rsplit(".", 1); ET.SubElement(suite, "testcase", classname=cls, name=name)
    ET.ElementTree(root).write(out); return 0
PY
cp "$WORK/pytestpy/pytest.py" "$WORK/pytestpy/src/pytest.py"
commit_all "$WORK/pytestpy"; expect pytest-shadow "$(grade "$WORK/pytestpy" pytestpy)" 0
caught_by pytestpy 'removed (foreign import hook|shadowing module): (src/)?pytest.py'

tree "$WORK/site"
printf 'import unittest\n' > "$WORK/site/sitecustomize.py"; printf 'x = 1\n' > "$WORK/site/src/usercustomize.py"; printf 'import pytest\n' > "$WORK/site/tests/conftest.py"
commit_all "$WORK/site"; expect sitecustomize "$(grade "$WORK/site" site)" 0
caught_by site 'removed foreign import hook'

tree "$WORK/monkey"
cat >> "$WORK/monkey/src/cueforge/__init__.py" <<'PY'

import _pytest.runner as _r
def _ok(item):
    return None
_r.pytest_runtest_call = _ok
PY
commit_all "$WORK/monkey"; expect runner-monkeypatch "$(grade "$WORK/monkey" monkey)" 0

tree "$WORK/atexit"
cat >> "$WORK/atexit/src/cueforge/__init__.py" <<'PY'

import atexit as _atexit, sys as _sys, os as _os
def _forge():
    for p in [a for a in _sys.argv if a.endswith(".xml")] + ["/logs/verifier/base.xml", "/logs/verifier/new.xml"]:
        try:
            _os.chmod(p, 0o644)
            open(p, "w").write('<?xml version="1.0"?><testsuite name="x"/>')
        except OSError:
            pass
_atexit.register(_forge)
PY
commit_all "$WORK/atexit"; expect atexit-rewrite "$(grade "$WORK/atexit" atexit)" 0

tree "$WORK/linger"
cat >> "$WORK/linger/src/cueforge/__init__.py" <<'PY'

import os as _os, subprocess as _sp, sys as _sys, json as _json
_F = r'''
import time, os, json, xml.etree.ElementTree as ET
cfg = json.load(open("/tests/config.json"))
stop = time.time() + 40
while time.time() < stop:
    for p in ("/logs/verifier/base.xml", "/logs/verifier/new.xml", "/logs/verifier/reports/base.xml", "/logs/verifier/reports/new.xml"):
        try:
            os.chmod(p, 0o666)
            root = ET.Element("testsuites"); s = ET.SubElement(root, "testsuite")
            for nid in cfg["f2p_node_ids"] + cfg["p2p_node_ids"]:
                c, n = nid.rsplit(".", 1); ET.SubElement(s, "testcase", classname=c, name=n)
            ET.ElementTree(root).write(p)
        except Exception:
            pass
    time.sleep(0.02)
'''
if _os.environ.get("_CF_FORGED") is None:
    _os.environ["_CF_FORGED"] = "1"
    try:
        _sp.Popen([_sys.executable, "-c", _F], start_new_session=True, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
    except Exception:
        pass
PY
commit_all "$WORK/linger"; expect lingering-forger "$(grade "$WORK/linger" linger)" 0
caught_by linger 'sweep: ended straggler'

tree "$WORK/exiting"
cat >> "$WORK/exiting/src/cueforge/__init__.py" <<'PY'

import os as _os, sys as _sys, json as _json
# forge the raw report pytest is about to write, then leave before it does
try:
    _raw = [a for a in _sys.argv if a.endswith(".xml")]
    _cfg = _json.load(open("/tests/config.json"))
    import xml.etree.ElementTree as _ET
    for _p in _raw:
        _root = _ET.Element("testsuites"); _s = _ET.SubElement(_root, "testsuite")
        for _nid in _cfg["f2p_node_ids"] + _cfg["p2p_node_ids"]:
            _c, _n = _nid.rsplit(".", 1); _ET.SubElement(_s, "testcase", classname=_c, name=_n)
        _ET.ElementTree(_root).write(_p)
    _os._exit(0)
except Exception:
    pass
PY
commit_all "$WORK/exiting"; expect early-exit-forge "$(grade "$WORK/exiting" exiting)" 0
caught_by exiting 'ended before its report was signed|not the one this run signed|the runner refused'

tree "$WORK/shadowjson"
printf 'def loads(*a, **k):\n    raise SystemExit(0)\n' > "$WORK/shadowjson/json.py"
commit_all "$WORK/shadowjson"; expect stdlib-shadow "$(grade "$WORK/shadowjson" shadowjson)" 0
caught_by shadowjson 'removed shadowing module: json.py'

echo
if [ "$PROBLEMS" -eq 0 ]; then echo "MATRIX: PASS"; else echo "MATRIX: $PROBLEMS PROBLEM(S)"; exit 1; fi
