#!/bin/bash
# Local mirror of the reference stage. Builds the verifier image the way the
# platform does (the environment image rebuilt from the env-log Step lines,
# plus python3 and the four verifier files), lays the repository in at the
# base tree as a git repo, and runs the real RUN TESTS block: once over the
# reference solution (oracle, expect reward 1) and once over the untouched
# base (nop, expect reward 0 with every pass-to-pass id still passing), then
# over any extra model.patch handed in.
#
#   ./verify_task.sh [label model.patch]...
#
# The published base sha does not exist in a locally created repository, so
# it is substituted in a scratch copy of tests/ for the local run only. The
# shipped tests/ is never edited.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TASK="$(cd "$HERE/.." && pwd)"
DEV="$TASK/dev"
SNAPSHOT="$TASK/../../../../snapshots/snapshot.borrower-v2-g1788153403578749.zip"
WORK="$(mktemp -d)"
IMAGE_ENV=portfire-env:v1
IMAGE_TESTS=portfire-site-sheet-verify:local
PUBLISHED_BASE=$(python3 -c 'import json;print(json.load(open("'"$TASK"'/tests/config.json"))["base_commit"])')
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n=== %s\n' "$*"; }

if ! docker image inspect "$IMAGE_ENV" >/dev/null 2>&1; then
  echo "environment image $IMAGE_ENV is missing; build it from the env-log Step lines first"
  exit 1
fi
LOCAL_BASE=$(docker run --rm "$IMAGE_ENV" git -C /app rev-parse HEAD)
echo "local base commit in the image: $LOCAL_BASE"

say "building the verifier image"
mkdir -p "$WORK/tests"
cp "$TASK/tests/test.sh" "$TASK/tests/grader.py" "$TASK/tests/test.patch" "$WORK/tests/"
sed "s/$PUBLISHED_BASE/$LOCAL_BASE/" "$TASK/tests/config.json" > "$WORK/tests/config.json"
sed -i "s/$PUBLISHED_BASE/$LOCAL_BASE/" "$WORK/tests/test.sh"
cat > "$WORK/Dockerfile.tests" <<DOCKER
FROM $IMAGE_ENV
USER root
RUN command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; }
COPY tests/test.sh /tests/test.sh
COPY tests/test.patch /tests/test.patch
COPY tests/grader.py /tests/grader.py
COPY tests/config.json /tests/config.json
RUN chmod +x /tests/test.sh
DOCKER
docker build -q -f "$WORK/Dockerfile.tests" -t "$IMAGE_TESTS" "$WORK" >/dev/null || exit 1

run_case() {
  local label="$1" patch="$2" out="$WORK/$1"
  mkdir -p "$out/artifacts" "$out/verifier"
  [ -n "$patch" ] && cp "$patch" "$out/artifacts/model.patch"
  docker run --rm --network none \
    -v "$out/artifacts:/logs/artifacts" \
    -v "$out/verifier:/logs/verifier" \
    "$IMAGE_TESTS" /tests/test.sh > "$out/stdout.txt" 2>&1
  printf '%-28s reward.json = %s\n' "$label" "$(cat "$out/verifier/reward.json" 2>/dev/null || echo MISSING)"
}

say "oracle run (reference solution applied)"
run_case oracle "$TASK/solution/solution.patch"

say "nop run (base state, nothing applied)"
run_case nop ""

CASES="oracle nop"
while [ $# -ge 2 ]; do
  say "$1 run ($2)"
  run_case "$1" "$2"
  CASES="$CASES $1"
  shift 2
done

say "summary"
for case in $CASES; do
  echo "--- $case"
  grep -E "^(P2P|\[verifier\] (✗|ERROR|WARNING|vitest child|no setpriv))|\[publish\]" "$WORK/$case/stdout.txt" | head -14
done
mkdir -p "$HERE/work"
for case in $CASES; do rm -rf "$HERE/work/$case"; cp -r "$WORK/$case" "$HERE/work/"; done
echo
echo "logs kept under $HERE/work/"
