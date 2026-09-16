#!/bin/bash
# One pass over everything the draft has to tell us, run the moment the
# platform answers again. Stops before the push so the diffs can be read.
#
#   ./finalize.sh GSDRWALQ3ORyaSublpdA
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bot="/root/mindriftwork/AQ_dragan/bin/gold_bot.py"
draft="${1:-GSDRWALQ3ORyaSublpdA}"
export GOLD_AUTH="${GOLD_AUTH:-$HOME/.config/gold/auth-dragan.json}"
task="$here/tasks/match-void-rescore"
drafted="$here/drafted"

step() { echo; echo "=== $*"; }

step "1. gold.tasks.get"
python3 "$bot" call gold.tasks.get "{\"submissionId\":\"$draft\"}" > "$here/draft.json" || exit 1
head -c 400 "$here/draft.json"; echo
repo_id=$(python3 -c "
import json,sys
d=json.load(open('$here/draft.json'))
t=d.get('task') or d.get('submission') or d
for k in ('repositoryId','repoId','repository'):
    v=t.get(k)
    if isinstance(v,str) and v: print(v); break
    if isinstance(v,dict) and v.get('id'): print(v['id']); break
")
base_commit=$(python3 -c "
import json
d=json.load(open('$here/draft.json'))
t=d.get('task') or d.get('submission') or d
for k in ('baseCommitHash','baseSha','baseCommit'):
    v=t.get(k)
    if isinstance(v,str) and v: print(v); break
")
echo "repoId=$repo_id baseCommit=$base_commit"
[ -n "$repo_id" ] && [ -n "$base_commit" ] || { echo "could not read the repo id or base commit; read draft.json by hand"; exit 1; }

step "2. environments and the build log"
python3 "$bot" envs "$repo_id" | tee "$here/envs.txt"
version=$(python3 -c "
import re,sys
text=open('$here/envs.txt').read()
nums=[int(n) for n in re.findall(r'\bv(?:ersion)?\s*[:= ]?\s*(\d+)', text)]
print(max(nums) if nums else 1)
")
echo "reading env-log for version $version"
python3 "$bot" env-log "$repo_id" "$version" > "$here/env-log.v$version.txt" 2>&1
echo "--- install steps in the build log:"
grep -E "^Step " "$here/env-log.v$version.txt" | grep -iE "npm|pip|cargo|install" || echo "  (none found — read the log before trusting the verifier)"
echo "--- image name candidates:"
grep -oE "[a-z0-9.-]+/[a-z0-9._/-]+:[a-zA-Z0-9._-]+" "$here/env-log.v$version.txt" | sort -u | head

step "3. pull the draft's own frozen files"
rm -rf "$drafted"; mkdir -p "$drafted"
python3 "$bot" pull "$draft" "$drafted" || echo "pull failed; the draft may hold nothing yet"
find "$drafted" -type f | sort

step "4. compare the frozen frame against ours"
for f in tests/grader.py pre_artifacts.sh tests/Dockerfile environment/Dockerfile; do
  if [ -f "$drafted/$f" ]; then
    if diff -q "$drafted/$f" "$task/$f" >/dev/null 2>&1; then
      echo "same: $f"
    else
      echo "DIFFERS: $f  (taking the draft's copy)"
      mkdir -p "$(dirname "$task/$f")"
      cp "$drafted/$f" "$task/$f"
    fi
  else
    echo "absent from the draft: $f"
  fi
done
if [ -f "$drafted/tests/test.sh" ]; then
  cp "$drafted/tests/test.sh" "$here/frame/test.sh.draft"
  python3 - <<'PY'
from pathlib import Path
import sys
here = Path("/root/mindriftwork/AQ_dragan/result/arenaflow-3736")
ours = (here / "frame" / "test.sh").read_text()
theirs = (here / "frame" / "test.sh.draft").read_text()
START = "# >>> RUN TESTS (task-specific) <<<"
END = "# >>> END RUN TESTS <<<"
def frame(t):
    return t[: t.index(START) + len(START)], t[t.index(END):]
if frame(ours) == frame(theirs):
    print("test.sh frame: identical outside the markers")
else:
    print("test.sh FRAME MOVED: regenerating from the draft's copy")
    (here / "frame" / "test.sh").write_text(theirs)
PY
  python3 "$here/mktestsh.py"
fi

step "5. fill the markers"
python3 - "$repo_id" "$base_commit" <<'PY'
import json, re, sys
from pathlib import Path
repo_id, base_commit = sys.argv[1], sys.argv[2]
here = Path("/root/mindriftwork/AQ_dragan/result/arenaflow-3736")
task = here / "tasks" / "match-void-rescore"

log = (here / "envs.txt").read_text()
images = re.findall(r"[a-z0-9.-]+/[a-z0-9._/-]+:[a-zA-Z0-9._-]+", log)
image = images[0] if images else None
print("image from envs:", image)

p = task / "task.toml"
s = p.read_text()
s = s.replace("platform://gold/repos/PENDING_REPO_ID", f"platform://gold/repos/{repo_id}")
s = s.replace("PENDING_BASE_COMMIT", base_commit)
if image:
    s = s.replace("PENDING_IMAGE", image)
p.write_text(s)

p = task / "tests" / "config.json"
cfg = json.loads(p.read_text())
cfg["base_commit"] = base_commit
p.write_text(json.dumps(cfg, indent=1) + "\n")

if image:
    for rel in ("tests/Dockerfile", "environment/Dockerfile"):
        f = task / rel
        f.write_text(f.read_text().replace("PENDING_IMAGE", image))
print("markers left:", [str(f.relative_to(task)) for f in task.rglob("*")
                        if f.is_file() and "PENDING" in f.read_text(errors="ignore")])
PY

step "6. refresh the push bundle"
rm -rf "$here/push"; mkdir -p "$here/push/environment" "$here/push/solution" "$here/push/tests"
cp "$task/task.toml" "$task/instruction.md" "$here/push/"
cp "$task/environment/Dockerfile" "$here/push/environment/"
cp "$task/solution/solution.patch" "$task/solution/solve.sh" "$here/push/solution/"
cp "$task/tests/Dockerfile" "$task/tests/test.sh" "$task/tests/grader.py" \
   "$task/tests/config.json" "$task/tests/test.patch" "$here/push/tests/"
[ -f "$task/pre_artifacts.sh" ] && cp "$task/pre_artifacts.sh" "$here/push/"
find "$here/push" -type f | sort

step "7. check against the floors"
python3 "$bot" check "$here/push"

echo
echo "Nothing has been pushed. Re-run ./verify_task.sh with AF_ENV_IMAGE set to the"
echo "real image, then: python3 $bot push $here/push $draft --yes"
