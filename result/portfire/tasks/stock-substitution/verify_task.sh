#!/bin/bash
# Local mirror of the reference stage. Builds an image the way the platform
# builds the environment (node:24-bookworm-slim + git, COPY repo/ /app, then the
# user Dockerfile in environment.v2.Dockerfile, then the platform's git config),
# lays the repository in at the base tree as a git repo, adds the verifier files,
# and runs the real RUN TESTS block twice: once over the reference solution
# (oracle, expect reward 1) and once over the untouched base (nop, expect reward
# 0 with every pass-to-pass id still passing).
#
#   ./verify_task.sh [extra-case-name extra-model.patch]...
#
# The published base sha does not exist in a locally created repository, so the
# sha is substituted in a scratch copy of tests/ for the local run only. The
# shipped tests/ is never edited.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/work" && pwd)"
WORK="$(mktemp -d)"
IMAGE_ENV=portfire-stock-substitution-env:local
IMAGE_TESTS=portfire-stock-substitution-tests:local
PUBLISHED_BASE=cbfb245b02c044e160ca8346fc17ce78eb374ddc
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n=== %s\n' "$*"; }

say "staging the base tree"
rm -rf "$WORK/app"
git -C "$REPO" archive base | (mkdir -p "$WORK/app" && tar -x -C "$WORK/app")
git -C "$WORK/app" init -q
git -C "$WORK/app" config user.name portfire
git -C "$WORK/app" config user.email portfire@local
git -C "$WORK/app" add -A
git -C "$WORK/app" commit -q -m "base"
LOCAL_BASE="$(git -C "$WORK/app" rev-parse HEAD)"
echo "local base commit: $LOCAL_BASE"

say "building the environment image"
# The platform image is node:24-bookworm-slim + git + COPY repo/ /app + the
# full npm ci / CI chain (see ../../env-log.v1.txt), rebuilt locally as
# portfire-env:v1 from those exact Step lines. Its node_modules are reused
# here; /app is replaced by the base tree staged above as a one-commit repo.
cat > "$WORK/Dockerfile.env" <<'DOCKER'
FROM portfire-env:v1
RUN mv /app/node_modules /node_modules_keep && rm -rf /app
COPY app /app
RUN mv /node_modules_keep /app/node_modules
WORKDIR /app
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
DOCKER
docker build -q -f "$WORK/Dockerfile.env" -t "$IMAGE_ENV" "$WORK" >/dev/null || exit 1

say "building the verifier image"
mkdir -p "$WORK/tests"
cp "$HERE/tests/test.sh" "$HERE/tests/grader.py" "$HERE/tests/test.patch" "$WORK/tests/"
sed "s/$PUBLISHED_BASE/$LOCAL_BASE/" "$HERE/tests/config.json" > "$WORK/tests/config.json"
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
  printf '%-10s reward.json = %s\n' "$label" "$(cat "$out/verifier/reward.json" 2>/dev/null || echo MISSING)"
}

say "oracle run (reference solution applied)"
run_case oracle "$HERE/solution/solution.patch"

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
  grep -E "^(P2P|\[verifier\] (✗|ERROR|WARNING))" "$WORK/$case/stdout.txt" | head -12
done
mkdir -p "$HERE/runs"
for case in $CASES; do rm -rf "$HERE/runs/$case"; cp -r "$WORK/$case" "$HERE/runs/"; done
echo
echo "logs kept under $HERE/runs/"
