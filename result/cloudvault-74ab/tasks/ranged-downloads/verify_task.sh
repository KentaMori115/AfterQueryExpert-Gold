#!/bin/bash
# Local stand-in for the platform pipeline: build the two images the task
# names, then drive tests/test.sh over a set of submitted patches.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../repo"
BASE="$HERE/../../repo-base"
WORK="${WORK:-/tmp/claude-0/-root-mindriftwork/74ab2514-8fb8-483c-afc5-91a24c0597bd/scratchpad/verify}"
# Docker tags are global on this box and several sessions build cloudvault
# images. A shared tag means whichever session built last owns it, and the
# other one grades its rows against a stranger's config.json without any
# sign that it happened, so both tags carry this work tree's name.
ENV_IMAGE="${ENV_IMAGE:-cloudvault-74ab-env:local}"
VERIFIER_IMAGE="${VERIFIER_IMAGE:-cloudvault-74ab-verifier:local}"

rm -rf "$WORK" && mkdir -p "$WORK/ctx/repo"
# The image the platform builds is the base tree with nothing installed, so
# the context is the pristine snapshot rather than the working tree.
tar --warning=no-timestamp -cf - -C "$BASE" . | tar --warning=no-timestamp -x -C "$WORK/ctx/repo"
# The steps the platform's own build log shows for environment v1, so a green
# run here means the same thing there. The one difference is the git history:
# the platform copies a checkout, this context has none, so one is made below
# and the sha it lands on is written into test.sh further down.
cat > "$WORK/ctx/Dockerfile" <<'EOF'
FROM node:24-bookworm-slim
RUN command -v git >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*; }
COPY repo/ /app
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /opt/task-npm \
  && printf '%s\n' '{"name":"aq-verifier-deps","private":true,"dependencies":{"jest":"29.7.0","ts-jest":"29.2.5","typescript":"5.8.3","@types/jest":"29.5.14","@types/node":"^20","@types/bcrypt":"6.0.0","uuid":"11.1.0","sharp":"0.35.3","bcrypt":"6.0.0","firebase-admin":"13.4.0"}}' > /opt/task-npm/package.json \
  && cd /opt/task-npm \
  && npm install \
  && rm -rf /opt/task-node_modules \
  && mv node_modules /opt/task-node_modules \
  && rm -rf /opt/task-npm \
  && mkdir -p /app \
  && cp -r /opt/task-node_modules /app/node_modules
ENV PATH="/opt/task-node_modules/.bin:${PATH}"
ENV NODE_PATH="/opt/task-node_modules"
RUN git config --global --add safe.directory /app \
 && cd /app && git init -q && git add -A \
 && git -c user.email=b@local -c user.name=base commit -qm base \
 && git config core.hooksPath /dev/null
EOF
docker build -q -t "$ENV_IMAGE" "$WORK/ctx" >/dev/null || { echo "env image build failed"; exit 1; }

mkdir -p "$WORK/tests"
cp "$HERE/tests/test.sh" "$HERE/tests/test.patch" "$HERE/tests/grader.py" "$HERE/tests/config.json" "$WORK/tests/"
# The local base image commits its own tree, so the sha test.sh restores the
# shipped suites from has to be rewritten to that one or the restore is a
# silent no-op and an edited base test would stand.
LOCAL_SHA="$(docker run --rm "$ENV_IMAGE" git -C /app rev-parse HEAD)"
OLD_SHA="$(sed -n 's/^BASE_SHA="\([0-9a-zA-Z_]*\)"$/\1/p' "$HERE/tests/test.sh" | head -1)"
[ -n "$OLD_SHA" ] || { echo "no BASE_SHA in test.sh"; exit 1; }
sed -i "s/$OLD_SHA/$LOCAL_SHA/" "$WORK/tests/test.sh"
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
