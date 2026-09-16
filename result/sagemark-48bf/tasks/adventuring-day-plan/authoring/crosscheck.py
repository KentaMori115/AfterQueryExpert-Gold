#!/usr/bin/env python3
"""Random scenarios through both readings of the rules; they must agree."""
import json, random, subprocess, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from reference import plan_day

WORK = pathlib.Path("/root/mindriftwork/AQ_dragan/result/sagemark-48bf/work")

CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
              "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
              "stunned", "unconscious"]


def scenario(rng):
    size = rng.choice([1, 2, 3, 4, 5, 6, 7])
    party = []
    for i in range(size):
        active = []
        if rng.random() < 0.35:
            active = rng.sample(CONDITIONS, rng.randint(1, 2))
        party.append({
            "id": f"pc{i}",
            "xp": rng.choice([0, 5, 60, 250, 290, 299, 300, 899, 900, 2699, 6499, 14000]),
            "state": {"active": active, "exhaustion": rng.choice([0, 0, 0, 1, 2, 3])},
        })
    picks = []
    for i in range(rng.randint(0, 6)):
        count = rng.randint(1, 6)
        picks.append({"id": f"p{i}", "monsterXps": [rng.choice([0, 5, 25, 50, 100, 200, 450, 1100]) for _ in range(count)]})
    return {"party": party, "slate": picks}

def main():
    rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 7)
    total = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    scenarios = [scenario(rng) for _ in range(total)]
    proc = subprocess.run([str(WORK / "scratch/run.sh"), "scratch/dump.ts"],
                          input=json.dumps(scenarios), capture_output=True, text=True, cwd=WORK)
    if proc.returncode != 0:
        print(proc.stderr[-3000:]); return 1
    theirs = json.loads(proc.stdout)
    bad = 0
    for index, s in enumerate(scenarios):
        mine = plan_day(s["party"], s["slate"])
        if mine != theirs[index]:
            bad += 1
            if bad <= 3:
                print("DIVERGE", json.dumps(s))
                print("  python:", json.dumps(mine))
                print("  node  :", json.dumps(theirs[index]))
    print(f"{total - bad} of {total} agree")
    return 1 if bad else 0

if __name__ == "__main__":
    raise SystemExit(main())
