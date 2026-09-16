#!/bin/bash
set -u
BASE=/root/mindriftwork/AQ_dragan/result/sheave/work
PATCHES=/tmp/sheave-probe-patches
OUT=/tmp/replay
rm -rf $OUT && mkdir -p $OUT
for p in "$PATCHES"/*.patch; do
  t=$(basename "$p" .patch)
  d="$OUT/$t"
  git -C "$BASE" archive --format=tar HEAD | (mkdir -p "$d" && tar -x -C "$d")
  ln -sfn /root/mindriftwork/AQ_dragan/result/sheave/repo/node_modules "$d/node_modules"
  ( cd "$d" && git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm base ) >/dev/null 2>&1
  if ! ( cd "$d" && git apply --whitespace=nowarn "$p" ) 2>"$OUT/$t.apply"; then
    echo "$t APPLY FAILED"; continue
  fi
  ( cd "$d" && git checkout -q HEAD -- test/cage.test.ts test/cli.test.ts test/costing.test.ts test/cycle.test.ts test/design.test.ts test/drum.test.ts test/errors.test.ts test/examples.test.ts test/power.test.ts test/report.test.ts test/rope.test.ts test/safety.test.ts test/shaft.test.ts test/structure.test.ts test/units.test.ts test/winder.test.ts examples/bolsover.winder examples/wheal-jane.winder examples/zollverein.winder 2>/dev/null )
  cp "$BASE/test/holding.test.ts" "$BASE/test/lowering.test.ts" "$d/test/"
  ( cd "$d" && node_modules/.bin/vitest run --reporter=junit --outputFile=/tmp/replay/$t.xml >"$OUT/$t.log" 2>&1 )
  python3 - "$t" <<'PY'
import sys, xml.etree.ElementTree as ET, os
t = sys.argv[1]
path = f"/tmp/replay/{t}.xml"
if not os.path.exists(path):
    print(f"{t}  NO REPORT"); raise SystemExit
root = ET.parse(path).getroot()
f2p_pass = f2p_fail = p2p_fail = 0
held = ("test/holding.test.ts", "test/lowering.test.ts")
for tc in root.iter("testcase"):
    cn = tc.attrib.get("classname", "")
    failed = any(ch.tag in ("failure", "error") for ch in tc)
    if cn in held:
        if failed: f2p_fail += 1
        else: f2p_pass += 1
    elif failed and not (cn == "test/structure.test.ts" and "runtime dependencies" in tc.attrib.get("name", "")):
        p2p_fail += 1
print(f"{t}  f2p {f2p_pass} pass / {f2p_fail} fail   p2p failures {p2p_fail}   SOLVED={'yes' if f2p_fail==0 and p2p_fail==0 else 'no'}")
PY
done
