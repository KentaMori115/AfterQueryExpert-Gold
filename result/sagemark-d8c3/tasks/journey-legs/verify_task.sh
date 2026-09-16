#!/bin/bash
# Local mirror of the reference stage. Rebuilds the platform environment image
# from the published build log's steps (node:24-bookworm-slim + git, COPY repo
# /app, npm ci, the git config), lays the repository in at the base tree as a
# git repo, adds the verifier files, and runs the real RUN TESTS block twice:
# once over the reference solution (oracle, expect reward 1) and once over the
# untouched base (nop, expect reward 0 with every pass-to-pass id still green).
#
#   ./verify_task.sh [extra-case-name extra-model.patch]...
#
# The published base sha does not exist in a locally created repository, so it
# is substituted in a scratch copy of tests/ for the local run only. The
# shipped tests/ is never edited.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../repo" && pwd)"
WORK="$(mktemp -d)"
IMAGE_ENV=sagemark-journey-legs-env:local
IMAGE_TESTS=sagemark-journey-legs-tests:local
PUBLISHED_BASE=00800e20bf11764d07d33a49ffd1f1798ed699ed
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n=== %s\n' "$*"; }

say "staging the base tree"
rm -rf "$WORK/app"
git -C "$REPO" archive base | (mkdir -p "$WORK/app" && tar -x -C "$WORK/app")
git -C "$WORK/app" init -q
git -C "$WORK/app" config user.name sagemark
git -C "$WORK/app" config user.email sagemark@local
git -C "$WORK/app" add -A
git -C "$WORK/app" commit -q -m "base"
LOCAL_BASE="$(git -C "$WORK/app" rev-parse HEAD)"
echo "local base commit: $LOCAL_BASE"

say "building the environment image"
cat > "$WORK/Dockerfile.env" <<'DOCKER'
FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY app /app
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive CI=true NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false NODE_OPTIONS=--max-old-space-size=4096
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*
RUN npm ci
RUN git config --global --add safe.directory /app && cd /app && git config core.hooksPath /dev/null
DOCKER
docker build -q -f "$WORK/Dockerfile.env" -t "$IMAGE_ENV" "$WORK" >/dev/null || exit 1

say "building the verifier image"
mkdir -p "$WORK/tests"
cp "$HERE/tests/grader.py" "$HERE/tests/test.patch" "$WORK/tests/"
sed "s/$PUBLISHED_BASE/$LOCAL_BASE/" "$HERE/tests/config.json" > "$WORK/tests/config.json"
sed "s/$PUBLISHED_BASE/$LOCAL_BASE/" "$HERE/tests/test.sh" > "$WORK/tests/test.sh"
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
  grep -E "^\[verifier\] (ERROR|WARNING)" "$WORK/$case/stdout.txt" | head -8
done
mkdir -p "$HERE/work-attacks"
for case in $CASES; do rm -rf "$HERE/work-attacks/$case"; cp -r "$WORK/$case" "$HERE/work-attacks/"; done
echo
echo "logs kept under $HERE/work-attacks/"
