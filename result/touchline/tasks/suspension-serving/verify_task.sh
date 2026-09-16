#!/bin/bash
# Local rehearsal of the real verifier. Builds the verifier image from the
# reconstructed environment image, then runs the bundle exactly as the platform
# does: model.patch into /logs/artifacts, /tests/test.sh, read reward.json.
#
# The only local deviation is the base commit. The platform tree carries the
# real .git at dcb5ed48; the snapshot zip carries none, so the local image
# commits the tree itself and config.json is pointed at that sha inside the
# container. Everything else is the shipped bundle byte for byte.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_IMG="${ENV_IMG:-touchline-env-v8}"
VERIFY_IMG="${VERIFY_IMG:-touchline-verifier}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

build() {
    mkdir -p "$WORK/ctx"
    cp "$HERE"/tests/test.sh "$HERE"/tests/test.patch "$HERE"/tests/grader.py \
       "$HERE"/tests/config.json "$WORK/ctx/"
    sed "s#^FROM .*#FROM ${ENV_IMG}#" "$HERE/tests/Dockerfile" > "$WORK/ctx/Dockerfile"
    docker build -q -t "$VERIFY_IMG" "$WORK/ctx" > /dev/null || return 1
}

run_case() {
    local name="$1" patch="${2:-}"
    mkdir -p "$WORK/in-$name"
    if [ -n "$patch" ]; then cp "$patch" "$WORK/in-$name/model.patch"; fi

    docker run --rm --network none \
        -v "$WORK/in-$name:/in:ro" \
        "$VERIFY_IMG" bash -c '
            set -u
            mkdir -p /logs/artifacts /logs/verifier
            [ -f /in/model.patch ] && cp /in/model.patch /logs/artifacts/model.patch
            BASE=$(git -C /app rev-parse HEAD)
            python3 - "$BASE" <<PYEOF
import json, sys
p = "/tests/config.json"
d = json.load(open(p))
d["base_commit"] = sys.argv[1]
json.dump(d, open(p, "w"))
PYEOF
            bash /tests/test.sh > /logs/verifier/test-stdout.txt 2>&1
            echo "REWARD $(cat /logs/verifier/reward.json 2>/dev/null || echo none)"
            grep -E "^(P2P|\[verifier\])" /logs/verifier/test-stdout.txt | tail -12
            ls /logs/verifier /logs/verifier/reports 2>/dev/null | tr "\n" " "; echo
        ' > "$WORK/out-$name.txt" 2>&1

    local reward
    reward="$(grep '^REWARD' "$WORK/out-$name.txt" | head -1)"
    printf '%-24s %s\n' "$name" "$reward"
    cp "$WORK/out-$name.txt" "$HERE/verify-$name.log"
}

echo "building verifier image from $ENV_IMG"
build || { echo "verifier image build failed"; exit 1; }

if [ "${1:-}" = "--only" ]; then
    shift
    for name in "$@"; do
        case "$name" in
            nop) run_case nop ;;
            oracle) run_case oracle "$HERE/solution/solution.patch" ;;
            *) run_case "attack-$name" "$HERE/attacks/$name.patch" ;;
        esac
    done
    exit 0
fi

run_case nop
run_case oracle "$HERE/solution/solution.patch"

for attack in "$HERE"/attacks/*.patch; do
    [ -e "$attack" ] || continue
    run_case "attack-$(basename "$attack" .patch)" "$attack"
done
