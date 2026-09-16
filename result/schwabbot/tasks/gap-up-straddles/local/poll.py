#!/usr/bin/env python3
"""One poll of the pipeline, printed compactly."""
import json, subprocess, sys
draft = sys.argv[1] if len(sys.argv) > 1 else "Nrt9DCbeEVsj8kAydaUv"
out = subprocess.run(["python3", "bin/gold_bot.py", "call", "gold.tasks.get",
                      json.dumps({"submissionId": draft})],
                     capture_output=True, text=True).stdout
task = json.loads(out.split("\n", 1)[1] if out[:1].isdigit() else out)
p = task["pipeline"]
print("status=%s stage=%s failed=%s" % (task["status"], p["stage"], p["failedStage"]))
for k in ["ciChecks", "aiCheck", "similarity", "oracleNop", "qualityCheck",
          "easinessProbe", "difficultyProbe", "failureValidation"]:
    v = p.get(k)
    print("  %-18s %s" % (k, v.get("status") if isinstance(v, dict) else v))
if p.get("failureReason"):
    print("reason:", p["failureReason"])
