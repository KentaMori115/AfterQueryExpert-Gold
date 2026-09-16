#!/usr/bin/env bash
# Run the real tests/test.sh in a container that stands in for the verifier.
#
#   ./verify_task.sh oracle   solution.patch applied  -> expect reward 1
#   ./verify_task.sh base     nothing applied         -> expect f2p 0, p2p all
#   ./verify_task.sh patch <file>                     -> any patch you like
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE=sbot07a9-env:v2
MODE="${1:-oracle}"
PATCHFILE="${2:-}"

RUN="$(mktemp -d)"
trap 'rm -rf "$RUN"' EXIT
mkdir -p "$RUN/tests" "$RUN/artifacts" "$RUN/verifier"
cp "$HERE/tests/test.sh" "$HERE/tests/grader.py" "$HERE/tests/test.patch" "$RUN/tests/"

# The platform base sha does not exist in the local git history, so grade
# against the local one; everything else in config.json is shipped as is.
LOCAL_BASE="$(docker run --rm "$IMAGE" cat /BASE_SHA | tr -d '\n')"
python3 - "$HERE/tests/config.json" "$RUN/tests/config.json" "$LOCAL_BASE" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["base_commit"] = sys.argv[3]
json.dump(cfg, open(sys.argv[2], "w"), indent=1)
PY

case "$MODE" in
  oracle) cp "$HERE/solution/solution.patch" "$RUN/artifacts/model.patch" ;;
  base)   : > "$RUN/artifacts/model.patch" ;;
  patch)  cp "$PATCHFILE" "$RUN/artifacts/model.patch" ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac

docker run --rm --network none \
  -v "$RUN/tests":/tests \
  -v "$RUN/artifacts":/logs/artifacts \
  -v "$RUN/verifier":/logs/verifier \
  "$IMAGE" bash /tests/test.sh >"$RUN/stdout.txt" 2>&1
STATUS=$?

echo "=== test.sh exit $STATUS"
tail -40 "$RUN/stdout.txt"
echo "=== reward.json"
cat "$RUN/verifier/reward.json" 2>/dev/null; echo
cp -f "$RUN/verifier/reward.json" "$HERE/local.reward.json" 2>/dev/null || true
cp -f "$RUN/stdout.txt" "$HERE/local.stdout.txt" 2>/dev/null || true
