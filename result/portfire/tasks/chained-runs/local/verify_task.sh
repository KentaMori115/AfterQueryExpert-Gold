#!/bin/bash
# Run the real tests/test.sh in a container that mirrors the verifier: the
# environment image plus python3, /tests holding the bundle files, /logs fresh.
#   solution -> reward 1, f2p 61/61, p2p 2117/2117
#   base     -> reward 0, f2p 0/61,  p2p 2117/2117, every id present
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
IMG=portfire-chained-runs-verify:v1
LOCAL_SHA=$(docker run --rm "$IMG" bash -lc 'cd /app && git rev-parse HEAD')
TESTS_LOCAL=$(mktemp -d)
cp -r "$TASK/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["base_commit"] = sha; json.dump(d, open(p, "w"), indent=1)
PYSUB
sed -i "s/^BASE=.*/BASE=$LOCAL_SHA/" "$TESTS_LOCAL/test.sh"

row() {
  local name="$1" patch="$2"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  if [ -n "$patch" ]; then cp "$patch" "$logs/artifacts/model.patch"; fi
  docker run --rm --network none --cpus 2 \
    -v "$TESTS_LOCAL:/tests:ro" -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  local rc=$?
  echo "=== $name (container rc $rc) ==="
  if [ -f "$logs/verifier/reward.json" ]; then
    python3 - "$logs" <<'PY'
import json, sys, xml.etree.ElementTree as ET, pathlib
logs = pathlib.Path(sys.argv[1])
print("reward.json:", (logs/"verifier"/"reward.json").read_text().strip())
for name in ("base.xml", "new.xml"):
    f = logs/"verifier"/"reports"/name
    if not f.exists(): f = logs/"verifier"/name
    if f.exists():
        cases = list(ET.parse(f).getroot().iter("testcase"))
        bad = [c for c in cases if any(k.tag in ("failure","error") for k in c)]
        print(f"{name}: {len(cases)} testcases, {len(bad)} failing")
    else:
        print(f"{name}: MISSING")
PY
  else
    echo "reward.json MISSING"; tail -40 "$logs/stdout.txt"
  fi
  echo "logs: $logs"
}

case "${1:-both}" in
  solution) row solution "$TASK/solution/solution.patch" ;;
  base) row base "" ;;
  patch) row "custom:$2" "$2" ;;
  *) row solution "$TASK/solution/solution.patch"; row base "" ;;
esac
