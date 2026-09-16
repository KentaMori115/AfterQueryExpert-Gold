#!/bin/bash
# Local mirror of the platform's reference run.
#
#   verify_task.sh solved   solution applied and committed, then graded
#   verify_task.sh base     nothing applied, then graded
#
# The environment image is rebuilt locally from the published Step lines, so
# its base commit is not the platform's. tests/ is copied and the local root
# sha substituted for the pinned one; the pushed artifacts keep the real sha.
set -uo pipefail
MODE="${1:-solved}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${VERIFY_WORK:-/tmp/sheave-verify-bd4f}"
ENV_IMAGE="${ENV_IMAGE:-sheave-env-bd4f}"
REAL_SHA="bb4eda665b5ba5e281155e94d4c72fee12ef2797"

rm -rf "$WORK" && mkdir -p "$WORK/logs"
LOCAL_SHA="$(docker run --rm --network none "$ENV_IMAGE" git -C /app rev-parse HEAD | tr -d '\r\n')"
echo "== local base $LOCAL_SHA (stands in for $REAL_SHA)"

cp -a "$HERE/tests" "$WORK/tests"
sed -i "s/$REAL_SHA/$LOCAL_SHA/g" "$WORK/tests/config.json" "$WORK/tests/test.sh"
# The published image cannot be pulled here; the locally rebuilt one stands in.
sed -i "s#^FROM .*#FROM $ENV_IMAGE#" "$WORK/tests/Dockerfile"

echo "== producing model.patch ($MODE)"
if [ "$MODE" = "solved" ]; then
  docker run --rm --network none \
    -v "$HERE/solution/solution.patch:/solution/solution.patch:ro" \
    -v "$WORK:/out" "$ENV_IMAGE" bash -lc "
      cd /app
      git apply --whitespace=nowarn /solution/solution.patch || exit 9
      git checkout -q -b feature/solution 2>/dev/null || true
      git add -A
      git -c user.name=oracle -c user.email=oracle@local commit -q --no-verify -m 'Apply reference solution' || true
      git diff --binary $LOCAL_SHA HEAD > /out/model.patch
      echo \"model.patch \$(wc -c < /out/model.patch) bytes\"
    " || exit 1
else
  : > "$WORK/model.patch"
fi

echo "== building verifier image"
docker build -q -t sheave-verify-bd4f -f "$WORK/tests/Dockerfile" "$WORK/tests" >/dev/null || exit 1

echo "== grading"
docker run --rm --network none \
  -v "$WORK/model.patch:/logs/artifacts/model.patch:ro" \
  -v "$WORK/logs:/logs/verifier" \
  sheave-verify-bd4f bash -lc '/tests/test.sh' > "$WORK/verifier.out" 2>&1
echo "-- reward: $(cat "$WORK/logs/reward.json" 2>/dev/null || cat "$WORK/logs/reward.txt" 2>/dev/null)"
grep -E "^\[verifier\]|selection" "$WORK/verifier.out" | tail -12
