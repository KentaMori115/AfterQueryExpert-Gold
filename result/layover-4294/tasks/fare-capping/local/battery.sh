#!/bin/bash
# Run one patch through the real verifier and print the reward line.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
TASK=$(cd "$HERE/.." && pwd)
WORKDIR="$TASK/../../work"
IMG=layover-4294-env:v1
LOCAL_SHA=$(git -C "$WORKDIR" rev-parse main)
TESTS_LOCAL=$(mktemp -d)
cp -r "$TASK/tests/." "$TESTS_LOCAL/"
python3 - "$TESTS_LOCAL/config.json" "$LOCAL_SHA" <<'PYSUB'
import json, sys
path, sha = sys.argv[1], sys.argv[2]
d = json.load(open(path)); d["base_commit"] = sha; json.dump(d, open(path, "w"), indent=1)
PYSUB

for patch in "$@"; do
  logs=$(mktemp -d)
  mkdir -p "$logs/artifacts" "$logs/verifier"
  [ -s "$patch" ] && cp "$patch" "$logs/artifacts/model.patch"
  docker run --rm --network none -v "$TESTS_LOCAL:/tests" -v "$logs:/logs" \
    "$IMG" bash -c 'bash /tests/test.sh' > "$logs/stdout.txt" 2>&1
  name=$(basename "$patch")
  if [ -f "$logs/verifier/reward.json" ]; then
    printf '%-24s %s\n' "$name" "$(cat "$logs/verifier/reward.json")"
  else
    printf '%-24s NO REWARD (%s)\n' "$name" "$logs"
  fi
  grep -E "INTEGRITY|TAMPER|refused" "$logs/stdout.txt" | head -3
  rm -rf "$logs"
done
