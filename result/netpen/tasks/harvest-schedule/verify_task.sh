#!/bin/bash
# Local stand-in for the platform pipeline: build the two images the task
# names, then drive tests/test.sh over a set of submitted patches.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../repo"
WORK="${WORK:-/tmp/claude-0/-root-mindriftwork/f9259aa9-06d8-4023-9fa6-548be2b7bc89/scratchpad/verify}"
ENV_IMAGE=netpen-env:local
VERIFIER_IMAGE=netpen-verifier:local

rm -rf "$WORK" && mkdir -p "$WORK/ctx/repo"
git -C "$REPO" archive --format=tar HEAD | tar -x -C "$WORK/ctx/repo"
cat > "$WORK/ctx/Dockerfile" <<'EOF'
FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
ENV NPM_CONFIG_LOGLEVEL=warn
RUN npm ci
RUN git config --global --add safe.directory /app \
 && cd /app && git init -q && git add -A \
 && git -c user.email=b@local -c user.name=base commit -qm base
EOF
docker build -q -t "$ENV_IMAGE" "$WORK/ctx" >/dev/null || { echo "env image build failed"; exit 1; }

mkdir -p "$WORK/tests"
cp "$HERE/tests/test.sh" "$HERE/tests/test.patch" "$HERE/tests/grader.py" "$HERE/tests/config.json" "$WORK/tests/"
# The local base image commits its own tree, so the sha test.sh restores the
# shipped suites from has to be rewritten to that one or the restore is a
# silent no-op and an edited base test would stand.
LOCAL_SHA="$(docker run --rm "$ENV_IMAGE" git -C /app rev-parse HEAD)"
sed -i "s/adc3a0734ce10ab43f410df405566ab3b665b6c8/$LOCAL_SHA/" "$WORK/tests/test.sh"
cat > "$WORK/tests/Dockerfile" <<EOF
FROM $ENV_IMAGE
USER root
RUN command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; }
COPY test.sh /tests/test.sh
COPY test.patch /tests/test.patch
COPY grader.py /tests/grader.py
COPY config.json /tests/config.json
RUN chmod +x /tests/test.sh
EOF
docker build -q -t "$VERIFIER_IMAGE" "$WORK/tests" >/dev/null || { echo "verifier image build failed"; exit 1; }

BASE_SHA="$LOCAL_SHA"
python3 - "$HERE/tests/config.json" "$BASE_SHA" <<'PY' > "$WORK/tests/config.local.json"
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["base_commit"] = sys.argv[2]
print(json.dumps(cfg, indent=1))
PY

run_case() {
  local label="$1" patch="$2"
  local logs="$WORK/logs-$label"
  rm -rf "$logs" && mkdir -p "$logs/artifacts" "$logs/verifier"
  [ -n "$patch" ] && cp "$patch" "$logs/artifacts/model.patch"
  docker run --rm --network none \
    -v "$logs:/logs" \
    -v "$WORK/tests/config.local.json:/tests/config.json:ro" \
    "$VERIFIER_IMAGE" bash /tests/test.sh > "$logs/stdout.txt" 2>&1
  local reward
  reward="$(python3 -c "import json,sys;d=json.load(open('$logs/verifier/reward.json'));print(d['reward'],d['f2p_passed'],'/',d['f2p_total'],d['p2p_passed'],'/',d['p2p_total'])" 2>/dev/null || echo "NO REWARD")"
  printf '%-22s %s\n' "$label" "$reward"
}

echo "== cases =="
run_case base ""
run_case oracle "$HERE/solution/solution.patch"
for extra in "$HERE/attacks"/*.patch; do
  [ -e "$extra" ] || continue
  run_case "$(basename "$extra" .patch)" "$extra"
done
