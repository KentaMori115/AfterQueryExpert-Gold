#!/bin/bash
# Local stand-in for the platform pipeline: build the two images the task
# names, then drive tests/test.sh over a set of submitted patches.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$HERE/../../base"
WORK="${WORK:-/tmp/claude-0/-root-mindriftwork/368c28e7-3533-427a-a8a9-a15f183ad5cf/scratchpad/verify}"
ENV_IMAGE=sheave-env:v1
VERIFIER_IMAGE=sheave-verifier:v1

rm -rf "$WORK" && mkdir -p "$WORK/ctx/repo"
cp -r "$BASE/." "$WORK/ctx/repo/"
cat > "$WORK/ctx/Dockerfile" <<'DOCKER'
FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN npm install --no-save --no-package-lock typescript@5.7.2 vitest@2.1.8 @types/node@22.10.2
RUN rm -f /app/package.json /app/package-lock.json
RUN git config --global --add safe.directory /app \
 && cd /app && git init -q && git add -A \
 && git -c user.email=b@local -c user.name=base commit -qm base
DOCKER
docker build -q -t "$ENV_IMAGE" "$WORK/ctx" >/dev/null || { echo "env image build failed"; exit 1; }

BASE_SHA="$(docker run --rm "$ENV_IMAGE" git -C /app rev-parse HEAD)"

mkdir -p "$WORK/tests"
cp "$HERE/tests/test.patch" "$HERE/tests/grader.py" "$WORK/tests/"
sed "s/bb4eda665b5ba5e281155e94d4c72fee12ef2797/$BASE_SHA/g" "$HERE/tests/test.sh" > "$WORK/tests/test.sh"
python3 - "$HERE/tests/config.json" "$BASE_SHA" <<'PY' > "$WORK/tests/config.json"
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["base_commit"] = sys.argv[2]
print(json.dumps(cfg, indent=1))
PY
cat > "$WORK/tests/Dockerfile" <<DOCKER
FROM $ENV_IMAGE
USER root
RUN command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; }
COPY test.sh /tests/test.sh
COPY test.patch /tests/test.patch
COPY grader.py /tests/grader.py
COPY config.json /tests/config.json
RUN chmod +x /tests/test.sh
DOCKER
docker build -q -t "$VERIFIER_IMAGE" "$WORK/tests" >/dev/null || { echo "verifier image build failed"; exit 1; }

run_case() {
  local label="$1" patch="$2"
  local logs="$WORK/logs-${label//:/-}"
  rm -rf "$logs" && mkdir -p "$logs/artifacts" "$logs/verifier"
  [ -n "$patch" ] && cp "$patch" "$logs/artifacts/model.patch"
  docker run --rm --network none \
    -v "$logs:/logs" \
    "$VERIFIER_IMAGE" bash /tests/test.sh > "$logs/stdout.txt" 2>&1
  local reward
  reward="$(python3 -c "import json;d=json.load(open('$logs/verifier/reward.json'));print(d['reward'],d['f2p_passed'],'/',d['f2p_total'],d['p2p_passed'],'/',d['p2p_total'])" 2>/dev/null || echo "NO REWARD")"
  printf '%-24s %s\n' "$label" "$reward"
}

case "${1:-all}" in
  base) run_case base "" ;;
  oracle) run_case oracle "$HERE/solution/solution.patch" ;;
  attacks)
    for p in "$HERE"/attacks/*.patch; do
      [ -e "$p" ] || continue
      run_case "attack:$(basename "$p" .patch)" "$p"
    done ;;
  *)
    run_case base ""
    run_case oracle "$HERE/solution/solution.patch"
    for p in "$HERE"/attacks/*.patch; do
      [ -e "$p" ] || continue
      run_case "attack:$(basename "$p" .patch)" "$p"
    done ;;
esac
echo "logs under $WORK"
