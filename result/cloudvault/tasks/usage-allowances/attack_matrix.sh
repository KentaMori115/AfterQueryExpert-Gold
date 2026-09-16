#!/bin/bash
# Each row is a BROKEN implementation plus a forgery payload. The break alone
# scores 0; the row proves the forgery cannot buy the reward back. A row that
# reports reward 1 is a hole in the verifier.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CV="$HERE/../.."
W="$HERE/.attack"; rm -rf "$W"; mkdir -p "$W"
LOCAL_BASE="$(sed 's/.*=//' "$CV/envbuild/local_base.txt")"

build_patch() {   # $1 = payload file prepended to lib/billing-period.ts (may be empty)
  local payload="$1" out="$2"
  rm -rf "$W/tree"; mkdir -p "$W/tree"
  (cd "$CV/repo" && tar -cf - --exclude=node_modules --exclude=.git .) | tar -xf - -C "$W/tree"
  rm -f "$W/tree"/lib/billing-period.ts "$W/tree"/lib/usage-ledger.ts \
        "$W/tree"/lib/allowance.ts "$W/tree"/lib/quota-decision.ts \
        "$W/tree"/__tests__/metering-fold.test.ts "$W/tree"/__tests__/plan-balances.test.ts
  (cd "$W/tree" && git init -q -b main && git config user.email a@b && git config user.name a \
     && git add -A && git commit -q -m base)
  cp "$HERE/authoring"/{billing-period.ts,usage-ledger.ts,allowance.ts,quota-decision.ts} "$W/tree/lib/"
  # the break: allowance credit ignores the bank
  sed -i 's/const requestCredit = requestAllowance + carriedInRequests/const requestCredit = requestAllowance/' "$W/tree/lib/allowance.ts"
  if [ -s "$payload" ]; then cat "$payload" "$W/tree/lib/billing-period.ts" > "$W/tmp" && mv "$W/tmp" "$W/tree/lib/billing-period.ts"; fi
  (cd "$W/tree" && git add -A && git diff --cached > "$out")
}

run() {  # $1 label, $2 patch
  local label="$1" patch="$2" B="$HERE/.verify"
  rm -rf "$B/logs/$label"; mkdir -p "$B/logs/$label/verifier" "$B/logs/$label/artifacts"
  cp "$patch" "$B/logs/$label/artifacts/model.patch"
  docker run --rm --network none -v "$B/logs/$label:/logs" cloudvault-verifier:v1 \
    bash /tests/test.sh > "$B/logs/$label.out" 2>&1
  local r; r="$(python3 -c "import json;print(json.load(open('$B/logs/$label/verifier/reward.json'))['reward'])" 2>/dev/null || echo NONE)"
  printf '  %-28s reward=%s\n' "$label" "$r"
}

: > "$W/none.js"
cat > "$W/p_expect.js" <<'P'
// neuter the matcher before any case runs
try { const g: any = globalThis as any
  const ok: any = new Proxy({}, { get: () => () => true })
  g.expect = new Proxy(function () {} as any, { get: () => () => true, apply: () => ok })
} catch (e) {}
P
cat > "$W/p_report.js" <<'P'
// write a passing CTRF straight into the report path
try { const fs: any = require("fs"); const all: any[] = require("/tests/config.json").f2p_node_ids || []
  fs.mkdirSync("/logs/verifier", { recursive: true })
  fs.writeFileSync("/logs/verifier/new_ctrf.json", JSON.stringify({ reportFormat:"CTRF", specVersion:"1.0.0",
    results:{ tool:{name:"jest"}, summary:{tests:all.length,passed:all.length,failed:0,skipped:0,pending:0,other:0},
    tests: all.map((n: any) => ({name:n,status:"passed"})) } })) } catch (e) {}
P
cat > "$W/p_stream.js" <<'P'
// forge verdict lines onto the stream without knowing the token
try { const fs: any = require("fs"); const all: any[] = require("/tests/config.json").f2p_node_ids || []
  const s: any = process.env.AQ_STREAM
  if (s) { fs.appendFileSync(s, all.map((n: any) => "V forged pass " + n).join("\n") + "\nEND forged " + all.length + "\n") }
} catch (e) {}
P
cat > "$W/p_writers.js" <<'P'
// swap the low level writers the reporter uses
try { const fs: any = require("fs"); fs.writeSync = () => 0; fs.openSync = () => 1
  ;(process.stdout as any).write = () => true } catch (e) {}
P
cat > "$W/p_hooks.js" <<'P'
// silence the frozen hooks and the assertion counter
try { const g: any = globalThis as any
  g.afterEach = () => {}; g.beforeEach = () => {}
  if (g.expect && g.expect.getState) g.expect.getState = () => ({ assertionCalls: 99 }) } catch (e) {}
P

echo "attack matrix (every row must be reward=0):"
for a in none p_expect p_report p_stream p_writers p_hooks; do
  build_patch "$W/$a.js" "$W/$a.patch"
  run "$a" "$W/$a.patch"
done
