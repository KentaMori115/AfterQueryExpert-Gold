#!/bin/bash
# Run the real tests/test.sh in a container, the way the platform does.
#
#   ./verify_task.sh oracle   the reference solution is the submission
#   ./verify_task.sh nop      nothing is submitted, the base state is graded
#   ./verify_task.sh <patch>  any other patch as the submission
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE_SHA=7bc88a1c75c331045b5714ee4a411e0321efc5a1
ENV_IMAGE=sbot-bca5-env:local
VERIFY_IMAGE=sbot-bca5-verify:local
MODE="${1:-oracle}"

case "$MODE" in
  oracle) PATCH="$HERE/solution/solution.patch" ;;
  nop)    PATCH="" ;;
  *)      PATCH="$MODE" ;;
esac

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  rm -rf "$HERE/local/ctx"
  mkdir -p "$HERE/local/ctx"
  cp -a "$HERE/../../repo" "$HERE/local/ctx/repo"
  find "$HERE/local/ctx/repo" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null
  docker build -q --build-arg "BASE_SHA=$BASE_SHA" \
    -f "$HERE/local/env.Dockerfile" -t "$ENV_IMAGE" "$HERE/local/ctx" >/dev/null || exit 1

  sed "s|^FROM .*|FROM $ENV_IMAGE|" "$HERE/tests/Dockerfile" > "$HERE/tests/Dockerfile.local"
  docker build -q -f "$HERE/tests/Dockerfile.local" -t "$VERIFY_IMAGE" "$HERE/tests" >/dev/null || exit 1
  rm -f "$HERE/tests/Dockerfile.local"
fi

RUN_DIR="$(mktemp -d "$HERE/local/run.XXXXXX")"
mkdir -p "$RUN_DIR/artifacts" "$RUN_DIR/verifier"
if [ -n "$PATCH" ]; then
  cp "$PATCH" "$RUN_DIR/artifacts/model.patch"
else
  : > "$RUN_DIR/artifacts/model.patch"
fi

docker run --rm --network none \
  -v "$RUN_DIR:/logs" \
  "$VERIFY_IMAGE" bash /tests/test.sh > "$RUN_DIR/stdout.txt" 2>&1
echo "===== reward ====="
cat "$RUN_DIR/verifier/reward.json" 2>/dev/null; echo
echo "===== tail ====="
tail -n 25 "$RUN_DIR/stdout.txt"
echo
echo "full log: $RUN_DIR/stdout.txt"
