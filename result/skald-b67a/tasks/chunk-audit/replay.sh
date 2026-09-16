#!/bin/bash
# Replay a calibration trial's own submission against the graded suites.
#
# The probes hand back each trial's model.patch, so the closest thing to a
# local calibration is to apply one to the base tree, install the held-back
# files exactly as the verifier does, and count what passes. It measures the
# suites against real submissions rather than against the reference, which is
# the one thing a mutation battery can never do.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../../repo"
PATCHES="${1:-/tmp/claude-0/-root-mindriftwork/b67a9e2a-abeb-46b8-a20c-886c966bed7e/scratchpad/trialpatches}"
for patch in "$PATCHES"/*.patch; do
  name="$(basename "$patch" .patch)"
  work="$(mktemp -d)"
  cp -a "$REPO/." "$work/" 2>/dev/null
  rm -rf "$work/target"
  ( cd "$work" && git init -q -b main && git add -A \
    && git -c user.name=b -c user.email=b@l commit -q -m base ) >/dev/null 2>&1
  if ! ( cd "$work" && git apply --whitespace=nowarn "$patch" ) 2>/dev/null; then
    echo "$name: patch did not apply"
    rm -rf "$work"; continue
  fi
  # the verifier installs the held-back files over whatever the trial left
  cp "$HERE/build/tests/image_faults.rs" "$HERE/build/tests/stack_shape.rs" "$work/tests/"
  # One invocation per target: cargo stops after a target that fails, which
  # would hide everything in the one behind it. The verifier names them singly
  # for the same reason.
  out="$( cd "$work" && timeout 600 cargo test --offline --test image_faults 2>&1; \
          cd "$work" && timeout 600 cargo test --offline --test stack_shape 2>&1 )"
  img=$(sed -n 's/^test result: ok\. \([0-9]*\) passed.*/\1/p' <<<"$out" | head -1)
  stk=$(sed -n 's/^test result: ok\. \([0-9]*\) passed.*/\1/p' <<<"$out" | tail -1)
  failed=$(grep -c "^test .* FAILED" <<<"$out")
  if grep -q "could not compile" <<<"$out"; then
    which=$(grep -m1 "could not compile" <<<"$out")
    echo "$name: COMPILE FAILED -- $which"
    grep -m3 "^error" <<<"$out" | sed 's/^/    /'
  else
    total=$(grep -c "^test .* \(ok\|FAILED\)$" <<<"$out")
    echo "$name: $((total - failed))/$total graded cases pass"
    grep "^test .* FAILED" <<<"$out" | sed 's/^test /    miss: /;s/ ... FAILED//' | head -12
  fi
  rm -rf "$work"
done
