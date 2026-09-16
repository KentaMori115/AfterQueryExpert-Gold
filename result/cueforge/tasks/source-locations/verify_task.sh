#!/bin/bash
# Local mirror of reference verification: run the real RUN TESTS block, the
# canonical grader and the real config inside the image rebuilt from the
# platform's own build log, on the base tree (expect reward 0, every f2p id
# present and failed) and on the solved tree (expect reward 1).
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

tree() {  # $1 destination, $2 "solution" to also apply the solution
  rm -rf "$1"; git -C "$BASE" worktree prune >/dev/null 2>&1
  git clone -q "$BASE" "$1" || { fail "clone"; return; }
  if [ "${2:-}" = solution ]; then
    ( cd "$1" && git apply --whitespace=nowarn "$HERE/solution/solution.patch" && git add -A \
      && git -c user.name=o -c user.email=o@l commit -q -m sol ) || fail "solution.patch does not apply"
  fi
}

grade() {  # $1 tree, $2 label, $3.. extra docker args
  local t="$1" label="$2"; shift 2
  local logs="$WORK/logs-$label"
  rm -rf "$logs"; mkdir -p "$logs/artifacts"; cp "$t/.model.patch" "$logs/artifacts/model.patch"
  rm -f "$t/.model.patch"; chmod -R 777 "$logs"
  docker run --rm --network none "$@" \
    -v "$t":/app -v "$logs":/logs \
    -v "$TESTS":/tests:ro \
    "$IMAGE" bash /tests/test.sh > "$logs/stdout.txt" 2>&1
  echo "$logs"
}

report() {  # $1 logs dir
  python3 - "$HERE/tests/config.json" "$1" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
logs = pathlib.Path(sys.argv[2])
verdicts = {}
for name in ("base.xml", "new.xml"):
    for cand in (logs / "verifier" / name, logs / "verifier" / "reports" / name):
        if cand.exists():
            for case in ET.parse(cand).iter("testcase"):
                nid = f"{case.get('classname')}.{case.get('name')}"
                bad = any(c.tag in ("failure", "error", "skipped") for c in case)
                verdicts[nid] = "fail" if bad else "pass"
f2p, p2p = cfg["f2p_node_ids"], cfg["p2p_node_ids"]
fp = sum(1 for i in f2p if verdicts.get(i) == "pass")
pp = sum(1 for i in p2p if verdicts.get(i) == "pass")
present = sum(1 for i in f2p + p2p if i in verdicts)
try:
    reward = json.loads((logs / "verifier" / "reward.json").read_text()).get("reward")
except Exception:
    reward = "missing"
print(f"f2p {fp}/{len(f2p)} pass, p2p {pp}/{len(p2p)} pass, {present}/{len(f2p)+len(p2p)} ids present, grader reward {reward}")
PY
}

expect() {  # $1 label, $2 line, $3 wanted reward
  echo "  $1: $2"
  case "$2" in *"grader reward $3"*) : ;; *) fail "$1 wanted reward $3" ;; esac
  local want; want=$(python3 -c "import json;c=json.load(open('$HERE/tests/config.json'));print(len(c['f2p_node_ids'])+len(c['p2p_node_ids']))")
  case "$2" in *"$want/$want ids present"*) : ;; *) fail "$1 dropped ids from the report" ;; esac
}

echo "== base tree (model.patch empty) =="
tree "$WORK/base"; : > "$WORK/base/.model.patch"
L=$(grade "$WORK/base" base); expect base "$(report "$L")" 0
grep -E 'runner:|integrity:|reports:|sweep:' "$L/stdout.txt" | head -8

echo "== solved tree (model.patch = solution.patch) =="
tree "$WORK/sol"; cp "$HERE/solution/solution.patch" "$WORK/sol/.model.patch"
L=$(grade "$WORK/sol" sol); expect solution "$(report "$L")" 1
grep -E 'runner:|integrity:|reports:' "$L/stdout.txt" | head -8

echo "== solved tree, not root =="
tree "$WORK/uid"; cp "$HERE/solution/solution.patch" "$WORK/uid/.model.patch"; chmod -R a+rwX "$WORK/uid"
L=$(grade "$WORK/uid" uid --user 1000); expect uid1000 "$(report "$L")" 1

echo
if [ "$PROBLEMS" -eq 0 ]; then echo "VERIFY: PASS"; else echo "VERIFY: $PROBLEMS PROBLEM(S)"; exit 1; fi
