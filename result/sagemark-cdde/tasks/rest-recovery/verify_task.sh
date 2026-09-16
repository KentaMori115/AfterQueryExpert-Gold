#!/bin/bash
# Local stand-in for the platform pipeline: build the two images the task
# names, then drive tests/test.sh over a set of submitted patches.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../repo"
WORK="${WORK:-/tmp/claude-0/-root-mindriftwork/cddec48f-6d76-4569-a54a-6ec6cb123937/scratchpad/verify}"
ENV_IMAGE=${ENV_IMAGE:-sagemark-env-v1}
VERIFIER_IMAGE=sagemark-verifier:v1

rm -rf "$WORK" && mkdir -p "$WORK"
# The environment image is the reconstruction in envbuild/ (node:24-bookworm-slim,
# the repository, npm ci, one commit), built once by hand because npm ci is slow.
docker image inspect "$ENV_IMAGE" >/dev/null 2>&1 || { echo "build $ENV_IMAGE first: docker build -t $ENV_IMAGE envbuild"; exit 1; }

mkdir -p "$WORK/tests"
cp "$HERE/tests/test.patch" "$HERE/tests/grader.py" "$HERE/tests/config.json" "$WORK/tests/"
# One local deviation: the platform tree carries the real .git at the base
# commit, the snapshot zip carries none, so the local image commits the tree
# itself. test.sh restores the shipped suites from that sha, so it is rewritten
# to the local one here and nowhere else.
BASE_SHA_LOCAL="$(docker run --rm "$ENV_IMAGE" git -C /app rev-parse HEAD)"
sed "s/00800e20bf11764d07d33a49ffd1f1798ed699ed/$BASE_SHA_LOCAL/g" "$HERE/tests/test.sh" > "$WORK/tests/test.sh"
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

BASE_SHA="$BASE_SHA_LOCAL"
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
