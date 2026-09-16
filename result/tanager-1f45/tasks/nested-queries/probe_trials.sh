#!/bin/bash
# Pull every completed probe trial's report for this task and tally which graded
# ids failed, per trial and across trials.
#
# A calibration number on its own says nothing about why. Three shapes look
# identical from outside and want opposite fixes: trials that fail one shared id
# (a rule the instruction never stated), trials that fail nothing but still
# score zero (a verifier that refused), and trials that pass everything (the
# task really is easy).
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 1
export GOLD_AUTH=${GOLD_AUTH:-~/.config/gold/auth-dragan.json}
TASK=${1:-V6ZjSgYCTQdKodMKrSjt}
OUT=${2:-/tmp/probe-$TASK}
mkdir -p "$OUT"

python3 bin/gold_bot.py runs "$TASK" 2>&1 | tee "$OUT/runs.txt"
ids=$(grep -oE '\b[A-Za-z0-9]{20}\b' "$OUT/runs.txt" | sort -u)
for run in $ids; do
  python3 bin/gold_bot.py run-files "$run" > "$OUT/$run.files.txt" 2>&1 || continue
  grep -oE 'probe/task__[^ ]*/(verifier|logs)/[^ ]*(ctrf\.json|run\.log|reward\.json)' "$OUT/$run.files.txt" | sort -u | while read -r path; do
    safe=$(echo "$path" | tr '/' '_')
    python3 bin/gold_bot.py run-files "$run" --path "$path" > "$OUT/$run.$safe" 2>&1 || true
  done
done

python3 - "$OUT" <<'PY'
import collections, json, pathlib, re, sys
out = pathlib.Path(sys.argv[1])
per_trial = {}
for f in out.glob("*ctrf.json*"):
    try:
        doc = json.loads(re.sub(r"^\d+\s*", "", f.read_text()))
    except Exception:
        continue
    tests = (doc.get("results") or {}).get("tests") or []
    failed = [t["name"] for t in tests if t.get("status") != "passed"]
    per_trial[f.name] = (len(tests), failed)
if not per_trial:
    print("no ctrf reports found yet")
    raise SystemExit
tally = collections.Counter()
for name, (total, failed) in sorted(per_trial.items()):
    print(f"{name}: {total - len(failed)}/{total} passed, {len(failed)} failed")
    tally.update(failed)
print("\nfailing ids across trials (count, id):")
for node, n in tally.most_common(25):
    print(f"  {n:3d}  {node}")
shared = [k for k, v in tally.items() if v == len(per_trial)]
if shared:
    print("\nEVERY trial failed these, which reads as a rule the instruction never stated:")
    for s in shared:
        print("   ", s)
PY
