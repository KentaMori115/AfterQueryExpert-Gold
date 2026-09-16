#!/bin/bash
# Local mirror of the reference stage: build the verifier image the way the
# platform does, then run the real tests/test.sh twice, once against the base
# tree and once with the reference solution applied as the submitted patch.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CV="$HERE/../.."
LOCAL_BASE="$(sed 's/.*=//' "$CV/envbuild/local_base.txt")"
BUILD="$HERE/.verify"
rm -rf "$BUILD"; mkdir -p "$BUILD/ctx" "$BUILD/logs" "$BUILD/artifacts"

cp "$HERE/tests/test.sh" "$HERE/tests/test.patch" "$HERE/tests/grader.py" "$BUILD/ctx/"
# same config, but pointed at the locally rebuilt image's base commit
python3 - "$HERE/tests/config.json" "$BUILD/ctx/config.json" "$LOCAL_BASE" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1])); cfg["base_commit"] = sys.argv[3]
json.dump(cfg, open(sys.argv[2], "w"), indent=1)
PY
sed 's#^FROM .*#FROM cloudvault-env:v1#' "$HERE/tests/Dockerfile" > "$BUILD/ctx/Dockerfile"

docker build -q -t cloudvault-verifier:v1 "$BUILD/ctx" >/dev/null || { echo "VERIFIER BUILD FAILED"; exit 1; }

run_case() {
  local label="$1" patch="$2"
  rm -rf "$BUILD/logs/$label"; mkdir -p "$BUILD/logs/$label/verifier" "$BUILD/logs/$label/artifacts"
  [ -n "$patch" ] && cp "$patch" "$BUILD/logs/$label/artifacts/model.patch"
  docker run --rm --network none \
    -v "$BUILD/logs/$label:/logs" \
    cloudvault-verifier:v1 bash /tests/test.sh > "$BUILD/logs/$label.out" 2>&1
  echo "=== $label: $(cat "$BUILD/logs/$label/verifier/reward.json" 2>/dev/null || echo 'NO reward.json')"
}

run_case base ""
run_case oracle "$HERE/solution/solution.patch"
