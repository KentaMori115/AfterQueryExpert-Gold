#!/bin/bash
# Submissions that try to be graded without doing the work. Every row is a
# model.patch built on the BASE tree, so a row that scores anything above zero
# is a hole. Rows that need the held-back modules to import at all carry the
# two models, and nothing else of the feature.
#   assert-neuter    unittest assertions turned into no-ops at import time
#   forge-report     the run writes /logs/verifier/new.xml itself
#   swap-graded      the held-back test file replaced with passing stubs
#   wipe-p2p         the repository's own suite emptied
#   sitecustomize    an import-time hook dropped at the repository root
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=$(cd "$HERE/../../repo" && pwd)
IMG=schwab-env-9c1f:v2

LOCAL_SHA=$(docker run --rm --network none "$IMG" git -C /app rev-parse HEAD)
TESTS_LOCAL=$(mktemp -d)
cp -r "$HERE/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
path, sha = sys.argv[1], sys.argv[2]
doc = json.load(open(path)); doc["base_commit"] = sha
json.dump(doc, open(path, "w"), indent=1)
PYSUB

row() {
  local name="$1" patch="$2"
  local logs
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  cp "$patch" "$logs/artifacts/model.patch"
  docker run --rm --network none \
    -v "$TESTS_LOCAL:/tests:ro" -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  if [ -f "$logs/verifier/reward.json" ]; then
    echo "$name -> $(cat "$logs/verifier/reward.json")"
  else
    echo "$name -> NO REWARD FILE (crash sentinel); stdout tail:"
    tail -5 "$logs/stdout.txt"
  fi
}

for patch in "$HERE"/attacks/*.patch; do
  [ -f "$patch" ] || continue
  row "$(basename "$patch" .patch)" "$patch"
done
