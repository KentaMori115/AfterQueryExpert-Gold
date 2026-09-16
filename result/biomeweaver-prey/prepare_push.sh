#!/bin/bash
# Everything between a finished local build and a push, in one run. Needs the
# platform: the draft carries the frozen frame and the base commit, and neither
# can be guessed.
#
#   ./prepare_push.sh            pull, splice, verify, stage
#   ./prepare_push.sh --push     the same, then push the staged files
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
task="$here/tasks/prey-competition"
draft_id="Iyqs0O4Gt2d1A2SMIabO"
bot="$here/../../bin/gold_bot.py"
export GOLD_AUTH="${GOLD_AUTH:-$HOME/.config/gold/auth-dragan.json}"

step() { echo; echo "== $*"; }

step "pulling the draft into $here/draft"
rm -rf "$here/draft"
python3 "$bot" pull "$draft_id" --dir "$here/draft" || exit 1

step "reading the base commit"
base="$(python3 - "$here/draft" <<'PY'
import json, re, sys
from pathlib import Path
root = Path(sys.argv[1])
toml = root / "task.toml"
if toml.exists():
    found = re.search(r'base_commit_hash\s*=\s*"([0-9a-f]{40})"', toml.read_text())
    if found:
        print(found.group(1))
        raise SystemExit
config = root / "tests" / "config.json"
if config.exists():
    value = json.loads(config.read_text()).get("base_commit", "")
    if re.fullmatch(r"[0-9a-f]{40}", str(value)):
        print(value)
        raise SystemExit
print("")
PY
)"
if [ -z "$base" ]; then
  echo "no base commit in the pulled draft; ask gold.tasks.get for it"
  exit 1
fi
echo "base commit $base"

step "writing the base commit into tests/config.json"
python3 - "$task/tests/config.json" "$base" <<'PY'
import json, sys
from pathlib import Path
path, base = Path(sys.argv[1]), sys.argv[2]
config = json.loads(path.read_text())
config["base_commit"] = base
path.write_text(json.dumps(config, indent=1) + "\n")
print(f"config.json now carries {base}")
PY

step "regenerating tests/test.sh from the draft's own frame"
if [ ! -f "$here/draft/tests/test.sh" ]; then
  echo "the draft carries no tests/test.sh to take the frame from"
  exit 1
fi
cp "$here/draft/tests/test.sh" "$here/frame/test.sh"
python3 "$here/mktestsh.py" || exit 1

step "verifying the reference in a container"
"$here/verify_task.sh" 2>&1 | tail -3

step "verifying the base tree scores zero"
"$here/verify_task.sh" base 2>&1 | tail -2

step "staging what is ours to push"
rm -rf "$here/push"
mkdir -p "$here/push/solution" "$here/push/tests"
# task.toml is generated with the draft. The two display fields are ours; every
# other byte comes back exactly as it was pulled, and set_display.py refuses to
# write if a third line moved.
"$here/set_display.py" "$here/draft/task.toml" "$here/push/task.toml" || exit 1
cp "$task/instruction.md" "$here/push/instruction.md"
cp "$task/solution/solution.patch" "$here/push/solution/solution.patch"
cp "$task/tests/test.sh" "$here/push/tests/test.sh"
cp "$task/tests/test.patch" "$here/push/tests/test.patch"
cp "$task/tests/config.json" "$here/push/tests/config.json"
python3 "$bot" check "$here/push" --offline

if [ "${1:-}" = "--push" ]; then
  step "pushing"
  python3 "$bot" push "$draft_id" --dir "$here/push" --yes
else
  echo
  echo "staged. push with:"
  echo "  GOLD_AUTH=\$HOME/.config/gold/auth-dragan.json python3 bin/gold_bot.py push $draft_id --dir result/biomeweaver-prey/push --yes"
fi
