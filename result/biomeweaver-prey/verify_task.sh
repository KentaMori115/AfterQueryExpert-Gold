#!/bin/bash
# Local mirror of the reference stage: build the verifier image from the
# environment image, apply the reference solution the way solve.sh does, and
# run the real tests/test.sh and tests/grader.py inside the container.
#
#   ./verify_task.sh            reference run, expects reward 1
#   ./verify_task.sh base       no solution at all, expects reward 0 with
#                               every pass-to-pass id still passing
#   ./verify_task.sh attack P   grade an arbitrary patch P as model.patch
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
task="$here/tasks/prey-competition"
mode="${1:-solution}"
patch="${2:-}"
env_image="${BWPREY_ENV_IMAGE:-bwprey-env:local}"

docker build -q -t bwprey-verify:local -f - "$task/tests" <<DOCKER
FROM $env_image
USER root
RUN command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*; }
COPY test.sh /tests/test.sh
COPY test.patch /tests/test.patch
COPY grader.py /tests/grader.py
COPY config.json /tests/config.json
RUN chmod +x /tests/test.sh
DOCKER
[ $? -eq 0 ] || { echo "verifier image build failed"; exit 1; }

out="$here/verify-out/$mode"
rm -rf "$out"; mkdir -p "$out"

attack_mount=()
if [ "$mode" = "attack" ]; then
  [ -f "$patch" ] || { echo "usage: $0 attack <patch>"; exit 2; }
  attack_mount=(-v "$(cd "$(dirname "$patch")" && pwd)/$(basename "$patch"):/solution/attack.patch:ro")
fi

docker run --rm --network none \
  -v "$task/solution/solution.patch:/solution/solution.patch:ro" \
  "${attack_mount[@]}" \
  -v "$out:/logs" \
  bwprey-verify:local bash -c '
set -u
cd /app
git config --global --add safe.directory /app >/dev/null 2>&1
if [ ! -d .git ]; then
  git init -q .
  git -c user.name=base -c user.email=base@local add -A
  git -c user.name=base -c user.email=base@local commit -q -m base
fi
base=$(git rev-parse HEAD)
python3 - "$base" <<PY
import json, sys
from pathlib import Path
p = Path("/tests/config.json")
cfg = json.loads(p.read_text())
cfg["base_commit"] = sys.argv[1]
p.write_text(json.dumps(cfg, indent=1) + "\n")
PY
mkdir -p /logs/artifacts /logs/verifier
if [ "'"$mode"'" = "solution" ]; then
  git apply --whitespace=nowarn /solution/solution.patch || { echo "solution.patch did not apply"; exit 3; }
  git checkout -q -b feature/solution
  git -c user.name=oracle -c user.email=oracle@local add -A
  git -c user.name=oracle -c user.email=oracle@local commit -q --no-verify -m "Apply reference solution"
  git diff "$base" HEAD > /logs/artifacts/model.patch
  git checkout -q "$base"
  git clean -fdq -e node_modules
elif [ "'"$mode"'" = "attack" ]; then
  cp /solution/attack.patch /logs/artifacts/model.patch
else
  : > /logs/artifacts/model.patch
fi
bash /tests/test.sh
echo "===== reward ====="
cat /logs/verifier/reward.json 2>/dev/null || cat /logs/verifier/reward.txt 2>/dev/null
' 2>&1 | tail -40
