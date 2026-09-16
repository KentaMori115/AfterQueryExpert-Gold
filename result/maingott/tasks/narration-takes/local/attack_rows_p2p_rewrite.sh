#!/bin/bash
# Attack matrix against the verifier, every attack row on the BASE tree (where
# the f2p cases genuinely fail), each checked for ids-present as well as
# reward. A defended attack leaves reward 0 with all 46 f2p ids and all 806
# p2p ids published; a successful fabrication shows reward 1 or fewer ids.
# Honest rows (solution, a solution bringing its own test file, a solution
# that appended to an existing test) must score 1. The last row is the
# documented residual of any in-process runner and is EXPECTED to score 1: if
# it ever scores 0 the residual has been closed and this file must say so.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
BUNDLE="$TASK"
REPO="$TASK/../../repo"
IMG=maingott-env:v4

# The bundle's config.json carries the platform base sha; the local image is
# its own one-commit repo, so the local runs use a scratch copy of tests/
# with that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(docker run --rm "$IMG" git -C /app rev-parse HEAD)
TESTS_LOCAL=$(mktemp -d)
cp -r "$BUNDLE/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["base_commit"] = sha; json.dump(d, open(p, "w"), indent=1)
PYSUB
F2P=46
P2P=806

run_row() {
  local name="$1" setup="$2" with_solution="${3:-no}" expect="${4:-0}"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ "$with_solution" = yes ]; then
    cp "$BUNDLE/solution/solution.patch" "$logs/artifacts/model.patch"
  fi
  docker run --rm --network none --cpus 2 \
    -v "$TESTS_LOCAL:/tests:ro" \
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
        # skipped cases (2 real_spec tests) are published but never graded
        n = sum(1 for c in ET.parse(f).getroot().iter("testcase") if not any(k.tag == "skipped" for k in c))
        if bucket=="f2p": f2p_present = n
        else: p2p_present = n
if name.startswith("residual_"):
    ok = (reward == 1)
    verdict = "RESIDUAL, as expected" if ok else "*** RESIDUAL CLOSED? update STATUS.md ***"
else:
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

echo "== p2p-time rewrite rows =="
run_row "heldout_rewritten_during_p2p" \
  'chmod -R a+w /app/tests; cat /attacks/rewrite_heldout_during_p2p.py >> /app/src/maingott_reel/__init__.py'
run_row "conftest_rewritten_during_p2p" \
  'chmod -R a+w /app/tests; cat /attacks/rewrite_conftest_during_p2p.py >> /app/src/maingott_reel/__init__.py'
run_row "heldout_rewritten_as_root_child" \
  'chmod -R a+w /app/tests; cat /attacks/rewrite_heldout_during_p2p.py >> /app/src/maingott_reel/__init__.py; rm -f /usr/bin/setpriv'
