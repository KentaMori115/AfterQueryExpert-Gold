#!/bin/bash
# Every row is applied to the base tree with no reference solution. A row that
# grades anything above 0 is a way to be paid for work not done.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${ATTACK_WORK:-/tmp/sheave-attack-bd4f}"
ENV_IMAGE="${ENV_IMAGE:-sheave-env-bd4f}"
REAL_SHA="bb4eda665b5ba5e281155e94d4c72fee12ef2797"

rm -rf "$WORK" && mkdir -p "$WORK"
LOCAL_SHA="$(docker run --rm --network none "$ENV_IMAGE" git -C /app rev-parse HEAD | tr -d '\r\n')"
cp -a "$HERE/tests" "$WORK/tests"
sed -i "s/$REAL_SHA/$LOCAL_SHA/g" "$WORK/tests/config.json" "$WORK/tests/test.sh"
sed -i "s#^FROM .*#FROM $ENV_IMAGE#" "$WORK/tests/Dockerfile"
docker build -q -t sheave-verify-bd4f -f "$WORK/tests/Dockerfile" "$WORK/tests" >/dev/null || exit 1

rm -rf "$WORK/tree" && mkdir -p "$WORK/tree"
unzip -q "${SNAPSHOT:-/root/mindriftwork/AQ_dragan/snapshots/snapshot.borrower-v2-g1788604137581395.zip}" -d "$WORK/tree"

fail=0
for row in "$@"; do
  name="$(basename "$row" .py)"
  rm -rf "$WORK/case" && cp -a "$WORK/tree" "$WORK/case"
  python3 "$row" "$WORK/case" || { echo "$name: could not be applied"; fail=1; continue; }
  ( cd "$WORK/case" && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm x )
  rm -rf "$WORK/logs" && mkdir -p "$WORK/logs"
  docker run --rm --network none -v "$WORK/case:/case:ro" -v "$WORK:/out" "$ENV_IMAGE" bash -lc "
    cd /app
    cp -a /case/. /app/ 2>/dev/null
    git add -A
    git -c user.name=a -c user.email=a@b commit -q --no-verify -m attack || true
    git diff --binary $LOCAL_SHA HEAD > /out/model.patch
  " >/dev/null 2>&1
  docker run --rm --network none \
    -v "$WORK/model.patch:/logs/artifacts/model.patch:ro" \
    -v "$WORK/logs:/logs/verifier" \
    sheave-verify-bd4f bash -lc '/tests/test.sh' > "$WORK/$name.out" 2>&1
  reward="$(python3 -c "import json,sys;print(json.load(open('$WORK/logs/reward.json'))['reward'])" 2>/dev/null || echo "none")"
  f2p="$(python3 -c "import json;d=json.load(open('$WORK/logs/reward.json'));print(d['f2p_passed'],'/',d['f2p_total'])" 2>/dev/null || echo "?")"
  p2p="$(python3 -c "import json;d=json.load(open('$WORK/logs/reward.json'));print(d['p2p_passed'],'/',d['p2p_total'])" 2>/dev/null || echo "?")"
  verdict="held"
  if [ "$reward" != "0" ]; then verdict="BROKEN"; fail=1; fi
  printf '%-22s reward=%-6s f2p=%-10s p2p=%-10s %s\n' "$name" "$reward" "$f2p" "$p2p" "$verdict"
done
exit "$fail"
