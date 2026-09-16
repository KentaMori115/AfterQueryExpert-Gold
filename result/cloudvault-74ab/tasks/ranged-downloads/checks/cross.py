#!/usr/bin/env python3
"""Check a TypeScript build against an independent reading of the same rules.

The Python side builds the multipart body as text and measures it, so the
framing is checked rather than repeated. Usage: cross.py <tree>
"""
import json
import os
import pathlib
import subprocess
import sys

SC = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SC))
from jobsgen import jobs
from oracle import plan

APP = sys.argv[1] if len(sys.argv) > 1 else "/root/mindriftwork/AQ_dragan/result/cloudvault-74ab/repo"

proc = subprocess.run(
    ["node", "--experimental-transform-types", "--import", str(SC / "harness" / "register.mjs"), str(SC / "drive.mjs")],
    input=json.dumps(jobs), capture_output=True, text=True,
    env=dict(os.environ, APP=APP, HARNESS_APP=APP,
             HARNESS_SHIM=str(SC / "harness" / "shim.mjs"), HARNESS_HOOKS=str(SC / "harness" / "hooks.mjs")))
if proc.returncode != 0:
    print(proc.stderr[-3000:])
    raise SystemExit(1)

bad = 0
for job, actual in zip(jobs, json.loads(proc.stdout)):
    want = json.loads(json.dumps(plan(job["manifest"], job["header"], job["boundary"])))
    if want != actual:
        bad += 1
        if bad <= 5:
            print("MISMATCH", job["header"], job["manifest"], job["boundary"])
            print("  python:", want)
            print("  build :", actual)
print(f"{APP}: compared {len(jobs)}, mismatches {bad}")
raise SystemExit(1 if bad else 0)
