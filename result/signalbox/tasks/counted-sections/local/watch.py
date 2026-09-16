#!/usr/bin/env python3
"""Poll the counted-sections pipeline and print a line whenever anything moves."""
import json
import os
import subprocess
import sys
import time

TASK = "7qYTzMwhbjTvnEMFuKUY"
BOT = "/root/mindriftwork/AQ_dragan/bin/gold_bot.py"
ENV = {**os.environ, "GOLD_AUTH": os.path.expanduser("~/.config/gold/auth-dragan.json")}
TERMINAL = {"Approved", "Validation Failed", "Rejected", "Needs Review"}
STAGES = ("ciChecks", "oracle", "qualityCheck", "easinessProbe",
          "difficultyProbe", "failureValidation")


def poll():
    out = subprocess.run([sys.executable, BOT, "call", "gold.tasks.get",
                          json.dumps({"submissionId": TASK})],
                         capture_output=True, text=True, env=ENV,
                         cwd="/root/mindriftwork/AQ_dragan", timeout=180)
    body = out.stdout.split("\n", 1)[1] if "\n" in out.stdout else ""
    return json.loads(body)


def line(r):
    p = r.get("pipeline") or {}
    bits = [f"status={r.get('status')}", f"review={r.get('reviewStatus')}"]
    for s in STAGES:
        v = p.get(s)
        bits.append(f"{s}={v.get('status') if isinstance(v, dict) else v}")
    if p.get("failedStage"):
        bits.append(f"FAILED[{p['failedStage']}/{p.get('failureKind')}] "
                    f"{str(p.get('failureReason'))[:300]}")
    return " | ".join(bits)


def main():
    prev = None
    while True:
        try:
            r = poll()
        except Exception as exc:  # a poll failure is not a verdict
            print(f"poll error: {type(exc).__name__}", flush=True)
            time.sleep(180)
            continue
        cur = line(r)
        if cur != prev:
            print(time.strftime("%H:%M ") + cur, flush=True)
            prev = cur
        if r.get("status") in TERMINAL:
            print("TERMINAL " + str(r.get("status")), flush=True)
            return
        time.sleep(180)


if __name__ == "__main__":
    main()
