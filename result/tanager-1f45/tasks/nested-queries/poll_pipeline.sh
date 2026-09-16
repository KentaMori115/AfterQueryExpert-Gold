#!/bin/bash
# Detached pipeline poller. Survives the session that started it: it is setsid
# detached, so a session boundary does not take the timeline with it. It only
# records; fixing a failed stage is the session's job, and pipeline.log is what
# the next session reads to know what happened while it was gone.
set -uo pipefail
cd /root/mindriftwork/AQ_dragan || exit 1
export GOLD_AUTH=${GOLD_AUTH:-/root/.config/gold/auth-dragan.json}
TASK="${1:-V6ZjSgYCTQdKodMKrSjt}"
LOG="${2:-/root/mindriftwork/AQ_dragan/result/tanager-1f45/tasks/nested-queries/pipeline.log}"
prev=""
while true; do
  out=$(timeout 120 python3 bin/gold_bot.py status "$TASK" 2>&1 || true)
  cur=$(printf '%s\n' "$out" | sed -n '1,10p')
  if [ "$cur" != "$prev" ]; then
    { echo "----- $(date -u '+%Y-%m-%d %H:%M:%SZ')"; printf '%s\n' "$cur"; } >> "$LOG"
    prev="$cur"
  fi
  case "$out" in
    *"status=Approved"*|*"status=Needs Review"*|*"status=Validation Failed"*|*"status=Rejected"*)
      { echo "----- $(date -u '+%Y-%m-%d %H:%M:%SZ') TERMINAL";
        printf '%s\n' "$out" | grep -E "^   \* |solved|failed|rejected" | head -12; } >> "$LOG"
      exit 0 ;;
  esac
  sleep 120
done
