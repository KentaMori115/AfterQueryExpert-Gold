#!/bin/bash
# Durable pipeline watcher: appends a line whenever a stage verdict changes, and
# keeps running across Claude session teardown so no transition is lost.
cd /root/mindriftwork/AQ_dragan || exit 1
export GOLD_AUTH=~/.config/gold/auth-dragan.json
LOG=/root/mindriftwork/AQ_dragan/result/tanager-6223/pipeline-watch.log
prev=""
while true; do
  out=$(python3 bin/gold_bot.py status VudIGx7iVZIpWmxzyVBJ 2>/dev/null | sed -n '1,10p')
  [ -n "$out" ] || { sleep 60; continue; }
  cur=$(echo "$out" | sed -n '2,9p' | awk '{print $NF}' | tr '\n' ' ')
  head=$(echo "$out" | head -1)
  if [ "$cur" != "$prev" ]; then
    printf '%s  %s\n  %s\n' "$(date -u +%H:%M:%S)" "$head" "$cur" >> "$LOG"
    prev="$cur"
  fi
  case "$head" in
    *"status=Validating"*) ;;
    *) printf '%s  TERMINAL %s\n' "$(date -u +%H:%M:%S)" "$head" >> "$LOG"; break ;;
  esac
  sleep 60
done
