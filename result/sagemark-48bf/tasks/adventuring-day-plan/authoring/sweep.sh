#!/bin/bash
S=/tmp/claude-0/-root-mindriftwork/48bfe264-33b3-435a-97bd-0bab051e9be3/scratchpad
W=/root/mindriftwork/AQ_dragan/result/sagemark-48bf/work
run() {
  local name="$1"
  cp "$S/variant.ts" "$W/src/core/rules/day-plan.ts"
  if [ -n "$2" ]; then sed -i "s/^  $2: false,/  $2: true,/" "$W/src/core/rules/day-plan.ts"; fi
  ( cd "$W" && timeout 900 npx vitest run --config vitest.held.config.ts tests/checks/day-that-holds.spec.ts --reporter=json --outputFile="$S/out-$name.json" >/dev/null 2>&1 )
  python3 - "$S/out-$name.json" "$name" <<'PY'
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception as e:
    print(f"{sys.argv[2]:<22} PARSE FAIL"); raise SystemExit
fails=[t for r in d.get("testResults",[]) for t in r.get("assertionResults",[]) if t["status"]!="passed"]
tot=sum(len(r.get("assertionResults",[])) for r in d.get("testResults",[]))
print(f"{sys.argv[2]:<22} {tot-len(fails)}/{tot} pass, {len(fails)} fail")
open(sys.argv[1]+".fails","w").write("\n".join(t["fullName"] for t in fails))
PY
}
run refimpl ""
for k in dawnMembership rosterAllowance tireFirst leftoverToOne leftoverRosterOrder roundMean greedy tireHardOnly spentRaw affordsStrict tieLonger tireEveryone gainedAbleOnly meanOverRoster sizeOverRoster; do run "$k" "$k"; done
cp "$S/day-plan.ref.ts" "$W/src/core/rules/day-plan.ts"
echo "restored reference"
