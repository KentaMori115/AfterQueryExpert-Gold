#!/bin/bash
# The battery only ever builds MY implementation, so a test that pins internal
# shape is invisible to it. This row builds a DIFFERENTLY shaped but correct
# implementation and must still score 1.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; CV="$HERE/../.."
W="$HERE/.alt"; rm -rf "$W"; mkdir -p "$W/tree"
(cd "$CV/repo" && tar -cf - --exclude=node_modules --exclude=.git .) | tar -xf - -C "$W/tree"
rm -f "$W/tree"/lib/{billing-period,usage-ledger,allowance,quota-decision}.ts "$W/tree"/__tests__/{metering-fold,plan-balances}.test.ts
(cd "$W/tree" && git init -q -b main && git config user.email a@b && git config user.name a && git add -A && git commit -q -m base)
cp "$HERE/authoring"/{billing-period.ts,usage-ledger.ts,allowance.ts,quota-decision.ts} "$W/tree/lib/"

cd "$W/tree"
# 1. periodAt by linear scan instead of estimate-and-step
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("lib/billing-period.ts"); s = p.read_text()
s = s.replace('''    // Months are uneven, so step from an estimate rather than dividing.
    let index = Math.max(0, Math.floor((at - periodBoundary(anchor, 0)) / (MS_PER_DAY * 31)))
    while (periodBoundary(anchor, index) > at) index -= 1
    while (periodBoundary(anchor, index + 1) <= at) index += 1
    return periodByIndex(anchor, index)''',
'''    let index = 0
    for (;;) {
        if (periodBoundary(anchor, index + 1) > at) break
        index += 1
    }
    return periodByIndex(anchor, index)''')
# 2. extra fields on every returned record, and a class rather than a literal
s = s.replace('''    return {
        index,
        startsAt: periodBoundary(anchor, index),
        endsAt: periodBoundary(anchor, index + 1),
    }''', '''    const rec: any = new (class {})()
    rec.endsAt = periodBoundary(anchor, index + 1)
    rec.startsAt = periodBoundary(anchor, index)
    rec.index = index
    rec.label = "period-" + index
    return rec as BillingPeriod''')
p.write_text(s)

p = pathlib.Path("lib/allowance.ts"); s = p.read_text()
# 3. an explicit loop instead of map, fields written in a different order
s = s.replace("    return ledger.map((period) => {", "    const out: PeriodBalance[] = []\n    for (const period of ledger) {")
s = s.replace('''        return {
            index: period.index,''', '''        const row: any = {}
        row.spare = null
        Object.assign(row, {
            index: period.index,''')
s = s.replace('''            withinPlan:
                requestOverage === 0 && bandwidthOverage === 0 && storageOverBytes === 0,
        }
    })
}''', '''            withinPlan:
                requestOverage === 0 && bandwidthOverage === 0 && storageOverBytes === 0,
        })
        out.push(row as PeriodBalance)
    }
    return out
}''')
p.write_text(s)

p = pathlib.Path("lib/usage-ledger.ts"); s = p.read_text()
# 4. peak from a sorted copy, plus an extra reported field
s = s.replace('''    return {
        index: period.index,''', '''    return {
        note: "metered",
        index: period.index,''')
s = s.replace("export interface PeriodUsage {", "export interface PeriodUsage {\n    note?: string")
p.write_text(s)
PY
git add -A && git diff --cached > "$W/alt.patch"

B="$HERE/.verify"; rm -rf "$B/logs/alt"; mkdir -p "$B/logs/alt/verifier" "$B/logs/alt/artifacts"
cp "$W/alt.patch" "$B/logs/alt/artifacts/model.patch"
docker run --rm --network none -v "$B/logs/alt:/logs" cloudvault-verifier:v1 bash /tests/test.sh > "$B/logs/alt.out" 2>&1
echo "alt-shape reward=$(python3 -c "import json;print(json.load(open('$B/logs/alt/verifier/reward.json'))['reward'])" 2>/dev/null || echo NONE)"
grep -E "\[publish\]" "$B/logs/alt.out" | head -2
