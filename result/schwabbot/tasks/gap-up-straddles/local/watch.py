#!/usr/bin/env python3
"""Poll one submission until its pipeline reaches a verdict."""

import json
import subprocess
import sys
import time

DRAFT = sys.argv[1] if len(sys.argv) > 1 else "Nrt9DCbeEVsj8kAydaUv"
TERMINAL = {"Needs Review", "Approved", "Validation Failed", "Rejected"}
STAGES = ["ciChecks", "aiCheck", "similarity", "oracleNop", "qualityCheck",
          "easinessProbe", "difficultyProbe", "failureValidation"]


def fetch():
    out = subprocess.run(
        ["python3", "bin/gold_bot.py", "call", "gold.tasks.get",
         json.dumps({"submissionId": DRAFT})],
        capture_output=True, text=True,
    ).stdout
    # the client prints the HTTP status on its own first line
    body = out.split("\n", 1)[1] if out[:1].isdigit() else out
    return json.loads(body)


for _ in range(160):
    try:
        task = fetch()
    except Exception as exc:
        print("poll failed: %s" % exc, flush=True)
        time.sleep(180)
        continue

    pipeline = task["pipeline"]
    done = [s for s in STAGES
            if isinstance(pipeline.get(s), dict)
            and pipeline[s].get("status") == "passed"]
    print("%s  %-18s stage=%-18s passed=%s%s"
          % (time.strftime("%H:%M:%S"), task["status"], pipeline["stage"],
             len(done),
             "  FAILED at %s: %s" % (pipeline["failedStage"],
                                     (pipeline["failureReason"] or "")[:300])
             if pipeline["failedStage"] else ""),
          flush=True)

    if task["status"] in TERMINAL:
        print("TERMINAL %s" % task["status"], flush=True)
        print(json.dumps(pipeline, indent=1)[:6000], flush=True)
        break
    time.sleep(180)
