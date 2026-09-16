#!/bin/bash
# Ask every trial build, and the reference, the same probe questions.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../repo"
PATCHES="${1:-/tmp/claude-0/-root-mindriftwork/b67a9e2a-abeb-46b8-a20c-886c966bed7e/scratchpad/trialpatches}"
OUT="$HERE/probe/answers"
mkdir -p "$OUT"

run_one() {
  local name="$1" patch="$2"
  local work; work="$(mktemp -d)"
  cp -a "$REPO/." "$work/" 2>/dev/null
  rm -rf "$work/target"
  ( cd "$work" && git init -q -b main && git add -A \
    && git -c user.name=b -c user.email=b@l commit -q -m base ) >/dev/null 2>&1
  if [ -n "$patch" ] && ! ( cd "$work" && git apply --whitespace=nowarn "$patch" ) 2>/dev/null; then
    echo "patch did not apply" > "$OUT/$name.txt"; rm -rf "$work"; return
  fi
  cp "$HERE/probe/probe.rs" "$work/tests/probe.rs"
  ( cd "$work" && timeout 600 cargo test --offline --test probe -- --nocapture 2>&1 ) \
    | grep -E "^[cs][0-9]+[a-z_0-9]* = |error\[|^error" > "$OUT/$name.txt"
  rm -rf "$work"
}

run_one reference "$HERE/bundle/solution/solution.patch" &
pids=($!)
for patch in "$PATCHES"/*.patch; do
  run_one "$(basename "$patch" .patch)" "$patch" &
  pids+=($!)
  if [ "${#pids[@]}" -ge 3 ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
done
wait
echo "answers in $OUT"
