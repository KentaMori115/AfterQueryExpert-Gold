#!/bin/bash
# Run the real tests/test.sh in a container that mirrors the verifier: the env
# image rebuilt from the published environment's own build log (python:3.12-slim
# + the eleven requirements + the repo at /app as a git repository at base),
# with /tests holding the bundle files and /logs a fresh directory. Two rows:
#   solution -> reward 1, f2p 47/47, p2p 62/62
#   base     -> reward 0, f2p 0/47,  p2p 62/62, every id present
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BUNDLE="$HERE"
IMG=schwab-env-9c1f:v2

# The bundle's config.json carries the platform base sha; the local image's
# /app is its own commit, so the local runs use a scratch copy of tests/ with
# that sha substituted. Nothing in the bundle itself is edited.
LOCAL_SHA=$(docker run --rm --network none "$IMG" git -C /app rev-parse HEAD)
TESTS_LOCAL=$(mktemp -d)
cp -r "$BUNDLE/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
path, sha = sys.argv[1], sys.argv[2]
doc = json.load(open(path))
doc["base_commit"] = sha
json.dump(doc, open(path, "w"), indent=1)
PYSUB

row() {
  local name="$1" with_solution="$2"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ "$with_solution" = yes ]; then
    cp "$BUNDLE/solution/solution.patch" "$logs/artifacts/model.patch"
  fi
  docker run --rm --network none \
    -v "$TESTS_LOCAL:/tests:ro" \
    -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  local rc=$?
  echo "=== $name (container rc $rc) ==="
  if [ -f "$logs/verifier/reward.json" ]; then
    python3 - "$logs" <<'PY'
import json, sys, pathlib, xml.etree.ElementTree as ET
logs = pathlib.Path(sys.argv[1])
reward = json.loads((logs / "verifier" / "reward.json").read_text())
print("reward.json:", json.dumps(reward))
for name in ("base.xml", "new.xml"):
    path = logs / "verifier" / "reports" / name
    if not path.exists():
        path = logs / "verifier" / name
    if path.exists():
        cases = list(ET.parse(path).getroot().iter("testcase"))
        failed = sum(1 for case in cases if case.find("failure") is not None)
        print(f"{name}: {len(cases)} testcases, {failed} failed")
    else:
        print(f"{name}: MISSING")
PY
  else
    echo "reward.json MISSING"
    tail -40 "$logs/stdout.txt"
  fi
  echo "logs: $logs"
}

row solution yes
row base no
