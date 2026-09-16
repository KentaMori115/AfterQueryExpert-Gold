#!/bin/bash
# Local mirror of the reference stage: it runs the task's own test.sh block in
# a container built from the same base the platform image uses, rather than a
# test of its own, because anything only test.sh does is otherwise never run.
#
#   REPEAT=2 ./verify_task.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/../../repo" && pwd)"
IMAGE="${IMAGE:-layover-bare}"
REPEAT="${REPEAT:-1}"
WORK="${WORKROOT:-$HERE/local/.scratch}/run.$$"
mkdir -p "$WORK"
[ -n "${KEEPWORK:-}" ] || trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*"; PROBLEMS=$((PROBLEMS + 1)); }
PROBLEMS=0

printf 'FROM python:3.12-slim\nRUN apt-get update && apt-get install -y --no-install-recommends git util-linux && rm -rf /var/lib/apt/lists/*\nWORKDIR /app\n' > "$WORK/Dockerfile"
docker build -q -t "$IMAGE" -f "$WORK/Dockerfile" "$WORK" >/dev/null || {
  echo "FAIL: the bare image would not build"; exit 1; }

python3 - "$HERE" <<'PY'
import pathlib, sys
here = pathlib.Path(sys.argv[1])
A = "# >>> RUN TESTS (task-specific) <<<"
B = "# >>> END RUN TESTS <<<"
frame = (here.parents[3] / "original_test.sh").read_text()
out = (here / "tests" / "test.sh").read_text()
fh, fr = frame.split(A, 1); _, ft = fr.split(B, 1)
oh, orr = out.split(A, 1); _, ot = orr.split(B, 1)
assert fh == oh and ft == ot, "test.sh has been edited outside the RUN TESTS markers"
print("frame: unchanged outside the markers")
PY
[ $? -eq 0 ] || fail "the frozen frame moved"

python3 - "$HERE" "$WORK/block.sh" <<'PY'
import pathlib, sys
here = pathlib.Path(sys.argv[1])
A = "# >>> RUN TESTS (task-specific) <<<"
B = "# >>> END RUN TESTS <<<"
text = (here / "tests" / "test.sh").read_text()
pathlib.Path(sys.argv[2]).write_text(text.split(A, 1)[1].split(B, 1)[0])
PY
cat > "$WORK/harness.sh" <<'SH2'
#!/bin/bash
set -uo pipefail
log() { echo "[verifier] $*"; }
export RUN_LOG=/logs/verifier/run.log
mkdir -p /logs/verifier; : > "$RUN_LOG"
run_log() { echo "+ $*" >> "$RUN_LOG" 2>/dev/null; "$@" 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }
source /block.sh
SH2

build_tree() {  # $1 target dir, $2 "sol" to also apply the solution
  rm -rf "$1"
  cp -r "$REPO" "$1"
  ( cd "$1" && git init -q -b main && git config user.email v@l && git config user.name v \
      && git add -A && git commit -qm base ) || return 1
  ( cd "$1" && patch -s -p1 < "$HERE/tests/test.patch" ) || return 1
  if [ "${2:-}" = sol ]; then
    ( cd "$1" && patch -s -p1 < "$HERE/solution/solution.patch" ) || return 1
  fi
  local sha
  sha="$(git -C "$1" rev-parse HEAD)"
  python3 - "$HERE/tests/config.json" "$WORK/config.$(basename "$1").json" "$sha" <<'PY'
import json, pathlib, sys
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
cfg["base_commit"] = sys.argv[3]
pathlib.Path(sys.argv[2]).write_text(json.dumps(cfg, indent=1))
PY
}

grade() {  # $1 tree, $2 label
  local tree="$1" label="$2"
  local logs="$WORK/logs-$label"
  rm -rf "$logs"; mkdir -p "$logs/verifier"; chmod -R 777 "$logs"
  docker run --rm --network none \
    -v "$tree":/app -v "$logs":/logs \
    -v "$WORK/harness.sh":/harness.sh:ro -v "$WORK/block.sh":/block.sh:ro \
    -v "$WORK/config.$(basename "$tree").json":/tests/config.json \
    -v "$HERE/tests/grader.py":/tests/grader.py \
    "$IMAGE" bash /harness.sh >"$WORK/out-$label.txt" 2>&1
  python3 - "$HERE/tests/config.json" "$logs/verifier" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
cfg = json.loads(pathlib.Path(sys.argv[1]).read_text())
verdicts = {}
for name in ("base.xml", "new.xml"):
    path = pathlib.Path(sys.argv[2]) / name
    if not path.exists():
        continue
    for case in ET.parse(path).iter("testcase"):
        nid = f"{case.get('classname')}.{case.get('name')}"
        bad = any(child.tag in ("failure", "error", "skipped") for child in case)
        verdicts[nid] = "fail" if bad else "pass"
f2p, p2p = cfg["f2p_node_ids"], cfg["p2p_node_ids"]
fp = sum(1 for i in f2p if verdicts.get(i) == "pass")
pp = sum(1 for i in p2p if verdicts.get(i) == "pass")
present = sum(1 for i in f2p if i in verdicts)
reward = 1 if f2p and fp == len(f2p) and pp == len(p2p) else 0
print(f"{fp}/{len(f2p)} f2p pass, {present}/{len(f2p)} f2p present,"
      f" {pp}/{len(p2p)} p2p pass, reward {reward}")
PY
}

for round in $(seq 1 "$REPEAT"); do
  echo "== round $round =="
  build_tree "$WORK/base" || fail "the base tree would not build"
  build_tree "$WORK/sol" sol || fail "the solution tree would not build"

  base_line="$(grade "$WORK/base" base)"
  sol_line="$(grade "$WORK/sol" sol)"
  echo "  base:     $base_line"
  echo "  solution: $sol_line"
  case "$base_line" in *"reward 0"*) : ;; *) fail "the unchanged repository did not score 0" ;; esac
  case "$base_line" in *"$(python3 -c "import json;print(len(json.load(open('$HERE/tests/config.json'))['f2p_node_ids']))")/"*" f2p present"*) : ;;
    *) fail "not every f2p id reached the base report" ;; esac
  case "$base_line" in *"0/"*" f2p pass"*) : ;; *) fail "an f2p id passes at the base" ;; esac
  case "$sol_line" in *"reward 1"*) : ;; *) fail "the reference solution did not score 1" ;; esac
done

echo
echo "== floors =="
python3 "$HERE/../../../../bin/gold_bot.py" check "$HERE" 2>/dev/null | sed -n '/floors/,/shape/p' || true

if [ "$PROBLEMS" -eq 0 ]; then
  echo "VERIFY: PASS"
else
  echo "VERIFY: $PROBLEMS PROBLEM(S) above; fix before submitting"
  exit 1
fi
