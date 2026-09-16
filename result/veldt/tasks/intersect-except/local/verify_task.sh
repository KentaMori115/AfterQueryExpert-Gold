#!/bin/bash
# Run the real tests/test.sh in a container that mirrors the verifier:
# the env image (python:3.12-slim + repo at /app + pytest) with /tests
# holding the bundle files and /logs a fresh directory. Two rows:
#   solution -> reward 1, f2p 112/112, p2p 938/938
#   base     -> reward 0, f2p 0/112,  p2p 938/938, every id present
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
BUNDLE="$TASK"
WORKDIR="$TASK/../../work"
IMG=veldt-env:v1

# The bundle's config.json carries the platform base sha; the local image is
# HEAD of the work repo's main, so the local runs use a scratch copy of tests/
# with that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(git -C "$WORKDIR" rev-parse main)
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
  docker run --rm \
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
        n = sum(1 for _ in ET.parse(f).getroot().iter("testcase"))
        print(f"{xmlname}: {n} testcases")
    else:
        print(f"{xmlname}: MISSING")
ctrf = logs/"verifier"/"ctrf.json"
if ctrf.exists():
    doc = json.loads(ctrf.read_text())
    s = doc["results"]["summary"]
    print("ctrf summary:", s)
PY
  else
    echo "reward.json MISSING"
    tail -30 "$logs/stdout.txt"
  fi
  echo "$logs"
}

row solution yes
row base no
