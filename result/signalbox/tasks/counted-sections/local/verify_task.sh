#!/bin/bash
# Run the real tests/test.sh in a container that mirrors the verifier: the
# environment image (python:3.12-slim + ffmpeg + the repo at /app + pytest)
# with /tests holding the bundle files and /logs a fresh directory.
#
# Two rows:
#   solution -> reward 1, f2p 46/46, p2p 806/806
#   base     -> reward 0, f2p 0/46,  p2p 806/806, every id present
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
BUNDLE="$TASK"
IMG=signalbox-cs:v2

# The bundle's config.json carries the platform base sha; the local image holds
# its own one-commit repo, so the local runs use a scratch copy of tests/ with
# that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(docker run --rm "$IMG" bash -lc 'cd /app && git rev-parse HEAD')
TESTS_LOCAL=$(mktemp -d)
cp -r "$BUNDLE/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["base_commit"] = sha; json.dump(d, open(p, "w"), indent=1)
PYSUB

row() {
  local name="$1" with_solution="$2"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ "$with_solution" = yes ]; then
    cp "$BUNDLE/solution/solution.patch" "$logs/artifacts/model.patch"
  fi
  docker run --rm --network none --cpus 2 \
    -v "$TESTS_LOCAL:/tests:ro" \
    -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  local rc=$?
  echo "=== $name (container rc $rc) ==="
  if [ -f "$logs/verifier/reward.json" ]; then
    python3 - "$logs" <<'PY'
import json, sys, xml.etree.ElementTree as ET, pathlib
logs = pathlib.Path(sys.argv[1])
r = json.loads((logs/"verifier"/"reward.json").read_text())
print("reward.json:", json.dumps(r))
for xmlname in ("base.xml", "new.xml"):
    f = logs/"verifier"/"reports"/xmlname
    if not f.exists():
        f = logs/"verifier"/xmlname
    if f.exists():
        root = ET.parse(f).getroot()
        cases = list(root.iter("testcase"))
        bad = [c for c in cases if any(k.tag in ("failure", "error") for k in c)]
        print(f"{xmlname}: {len(cases)} testcases, {len(bad)} failing")
    else:
        print(f"{xmlname}: MISSING")
PY
  else
    echo "reward.json MISSING"
    tail -40 "$logs/stdout.txt"
  fi
  echo "logs: $logs"
}

row solution yes
row base no
