#!/bin/bash
# Poll the counted-sections pipeline every 3 minutes and print a line whenever
# anything moves. Exits once the pipeline reaches a terminal state.
export GOLD_AUTH=~/.config/gold/auth-dragan.json
cd /root/mindriftwork/AQ_dragan || exit 1
prev=""
while true; do
  cur=$(timeout 120 python3 bin/gold_bot.py call gold.tasks.get \
        '{"submissionId":"7qYTzMwhbjTvnEMFuKUY"}' 2>/dev/null | tail -n +2 | python3 -c '
import sys, json
try:
    r = json.load(sys.stdin)
except Exception:
    print("poll failed"); raise SystemExit
p = r.get("pipeline") or {}
bits = [f"status={r.get(\"status\")}", f"review={r.get(\"reviewStatus\")}"]
for stage in ("ciChecks","oracle","qualityCheck","easinessProbe","difficultyProbe","failureValidation"):
    v = p.get(stage)
    if isinstance(v, dict):
        bits.append(f"{stage}={v.get(\"status\")}")
    elif v is not None:
        bits.append(f"{stage}={v}")
if p.get("failedStage"):
    bits.append(f"FAILED={p.get(\"failedStage\")}: {str(p.get(\"failureReason\"))[:300]}")
    bits.append(f"kind={p.get(\"failureKind\")}")
if r.get("rejection"):
    bits.append(f"rejection={str(r.get(\"rejection\"))[:400]}")
print(" | ".join(bits))
')
  if [ "$cur" != "$prev" ] && [ -n "$cur" ]; then
    echo "$(date -u +%H:%M) $cur"
    prev="$cur"
  fi
  case "$cur" in
    *"status=Approved"*|*"status=Validation Failed"*|*"status=Rejected"*|*"status=Needs Review"*)
      echo "TERMINAL: $cur"; exit 0 ;;
  esac
  sleep 180
done
