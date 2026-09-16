#!/bin/bash
# Local stand-in for the platform verifier run.
#
# Builds an agent image that matches the published environment step for step,
# with /app a git repository at the base commit, then builds the verifier
# image from tests/ exactly as tests/Dockerfile does, and runs the real
# tests/test.sh over a chosen model.patch.
#
#   local/verify_task.sh solution   reference solution -> expect reward 1
#   local/verify_task.sh base       no patch           -> expect reward 0
#   local/verify_task.sh <file>     any patch file
set -uo pipefail

TASK="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$TASK/../.." && pwd)"
WORK="$ROOT/work"
BUILD="$TASK/build"
WHICH="${1:-solution}"

rm -rf "$BUILD"
mkdir -p "$BUILD/ctx" "$BUILD/logs/verifier" "$BUILD/logs/artifacts"

# --- agent image: the published steps, plus a git repo at the base commit ---
git -C "$WORK" archive main | tar -x -C "$BUILD/ctx"
cat > "$BUILD/agent.Dockerfile" <<'EOF'
FROM sbot-8f3a-env:v2
COPY ctx/ /app
WORKDIR /app
RUN git init -q /app \
 && git -C /app config user.email base@local \
 && git -C /app config user.name base \
 && git -C /app add -A \
 && git -C /app commit -q -m base \
 && git config --global --add safe.directory /app \
 && git -C /app config core.hooksPath /dev/null
EOF
docker build -q -f "$BUILD/agent.Dockerfile" -t sbot-8f3a-agent:local "$BUILD" >/dev/null || exit 1
BASE_SHA=$(docker run --rm sbot-8f3a-agent:local git -C /app rev-parse HEAD)
echo "[verify] local base commit $BASE_SHA"

# --- verifier image: tests/, with config.json pointed at the local base ---
mkdir -p "$BUILD/tests"
cp "$TASK/tests/test.sh" "$TASK/tests/test.patch" "$TASK/tests/grader.py" \
   "$TASK/tests/Dockerfile" "$BUILD/tests/"
python3 - "$TASK/tests/config.json" "$BUILD/tests/config.json" "$BASE_SHA" <<'EOF'
import json, sys
config = json.load(open(sys.argv[1]))
config["base_commit"] = sys.argv[3]
json.dump(config, open(sys.argv[2], "w"), indent=1)
EOF
sed -i 's|^FROM .*|FROM sbot-8f3a-agent:local|' "$BUILD/tests/Dockerfile"
docker build -q -f "$BUILD/tests/Dockerfile" -t sbot-8f3a-verify:local "$BUILD/tests" >/dev/null || exit 1

# --- the submission under test ---
case "$WHICH" in
  solution) cp "$TASK/solution/solution.patch" "$BUILD/logs/artifacts/model.patch" ;;
  base)     : > "$BUILD/logs/artifacts/model.patch" ;;
  *)        cp "$WHICH" "$BUILD/logs/artifacts/model.patch" ;;
esac

docker run --rm --network none \
  -v "$BUILD/logs:/logs" \
  sbot-8f3a-verify:local bash /tests/test.sh > "$BUILD/run.out" 2>&1
echo "[verify] test.sh exit $?"
tail -3 "$BUILD/run.out"
echo "[verify] reward.json: $(cat "$BUILD/logs/verifier/reward.json" 2>/dev/null)"
