#!/bin/bash
# Run the real tests/test.sh in a container that mirrors the verifier: the
# environment image (python:3.12-slim + the repo at /app) with /tests holding
# the bundle files and /logs a fresh directory. Two rows:
#   solution -> reward 1, f2p 62/62,  p2p 1807/1807
#   base     -> reward 0, f2p 0/62,   p2p 1807/1807, every id present
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
WORKDIR="$TASK/../../work"
IMG=layover-4294-env:v1

# The bundle's config.json carries the platform base sha; the local image is
# HEAD of the work repository's main, so the local runs use a scratch copy of
# tests/ with that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(git -C "$WORKDIR" rev-parse main)
TESTS_LOCAL=$(mktemp -d)
cp -r "$TASK/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
path, sha = sys.argv[1], sys.argv[2]
document = json.load(open(path))
document["base_commit"] = sha
json.dump(document, open(path, "w"), indent=1)
PYSUB

row() {
  local name="$1" patch="$2"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ -n "$patch" ]; then
    cp "$patch" "$logs/artifacts/model.patch"
  fi
  docker run --rm --network none \
    -v "$TESTS_LOCAL:/tests" \
    -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' \
    > "$logs/stdout.txt" 2>&1
  local rc=$?
  echo "=== $name (container rc $rc) ==="
  if [ -f "$logs/verifier/reward.json" ]; then
    python3 - "$logs" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
logs = pathlib.Path(sys.argv[1])
print("reward.json:", (logs / "verifier" / "reward.json").read_text())
for name in ("base.xml", "new.xml"):
    found = logs / "verifier" / "reports" / name
    if not found.exists():
        found = logs / "verifier" / name
    if found.exists():
        cases = list(ET.parse(found).getroot().iter("testcase"))
        failed = sum(1 for c in cases if len(c))
        print("%s: %d cases, %d not passing" % (name, len(cases), failed))
    else:
        print("%s: MISSING" % name)
PY
    grep -E "^\[publish\]|INTEGRITY|WARNING" "$logs/stdout.txt" | head -20
  else
    echo "reward.json MISSING"
    tail -40 "$logs/stdout.txt"
  fi
  echo "logs: $logs"
}

row solution "$TASK/solution/solution.patch"
row base ""
