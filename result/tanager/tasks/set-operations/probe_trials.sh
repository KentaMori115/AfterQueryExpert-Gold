#!/bin/bash
# Grade the eight calibration-probe submissions locally.
#
# Calibration II scored 0 of 8 because the verifier zeroed every trial, so the
# number it reported says nothing about the task. These are the same eight
# model.patch files, graded by the fixed verifier: what comes out here is what
# the probe would have measured, and the band it has to land in is 1 to 6.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../repo" && pwd)"
BUNDLE="$HERE/bundle"
ENV_IMAGE="${ENV_IMAGE:-fwctl-env:v1}"
IMAGE="${IMAGE:-fwctl-verify:local}"
WORK="${WORK:-/tmp/fwctl-trials}"
LANES="${LANES:-3}"

FREE_MB="$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "$FREE_MB" ] && [ "$FREE_MB" -lt $(( 3000 * LANES )) ]; then
  echo "REFUSING: ${FREE_MB} MB free is not enough for ${LANES} lanes"; exit 1
fi

mkdir -p "$WORK"
sed "s|^FROM .*|FROM $ENV_IMAGE|" "$BUNDLE/tests/Dockerfile" > "$WORK/tests.Dockerfile"
docker build -q -t "$IMAGE" -f "$WORK/tests.Dockerfile" "$BUNDLE/tests" >/dev/null || exit 1

one() {
  local name="$1" patch="$2"
  local root="$WORK/$name"
  rm -rf "$root"; mkdir -p "$root/logs/artifacts" "$root/logs/verifier"
  cp -a "$REPO" "$root/app"
  ( cd "$root/app" && git init -q -b main \
      && git -c user.name=b -c user.email=b@l add -A \
      && git -c user.name=b -c user.email=b@l commit -q -m base ) || return 1
  cp "$patch" "$root/logs/artifacts/model.patch"
  docker run --rm --network none \
    -v "$root/app:/app" -v "$root/logs:/logs" \
    "$IMAGE" bash /tests/test.sh > "$root/stdout.txt" 2>&1
}

names=()
for f in "$HERE"/trials/*.patch; do names+=("$(basename "$f" .patch)"); done

i=0
while [ "$i" -lt "${#names[@]}" ]; do
  pids=()
  for _ in $(seq 1 "$LANES"); do
    [ "$i" -lt "${#names[@]}" ] || break
    one "${names[$i]}" "$HERE/trials/${names[$i]}.patch" &
    pids+=($!)
    i=$((i + 1))
  done
  for pid in "${pids[@]}"; do wait "$pid"; done
done

solved=0
echo "== trials =="
for n in "${names[@]}"; do
  line="$(grep -E '^P2P [0-9]+/' "$WORK/$n/stdout.txt" | tail -1)"
  reward="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["reward"])' \
             "$WORK/$n/logs/verifier/reward.json" 2>/dev/null || echo "?")"
  [ "$reward" = "1" ] && solved=$((solved + 1))
  printf '  %-10s reward %-3s %s\n' "$n" "$reward" "$line"
  grep -E '^\[verifier\] (INTEGRITY|DISBELIEVED)' "$WORK/$n/stdout.txt" | sed 's|^|      |'
done
echo
echo "solved $solved of ${#names[@]}  (Calibration II band is 1 to 6)"
