#!/bin/bash
# Fill the six PENDING markers in the reward-recall bundle.
#   ./fill_pending.sh <repoId> <baseCommitSha> <dockerImage>
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <repoId> <baseCommitSha> <dockerImage>"; exit 2; }
repo="$1"; base="$2"; image="$3"
case "$base" in
  *[!0-9a-f]*|"") echo "base commit must be lowercase hex: $base" >&2; exit 2 ;;
esac
[ ${#base} -eq 40 ] || echo "warning: base commit is ${#base} chars, expected 40" >&2

t="$(cd "$(dirname "$0")" && pwd)/tasks/reward-recall"
cp -a "$t" "$t.bak.$(date +%s)"

sed -i "s|PENDING_REPO_ID|$repo|g"      "$t/task.toml"
sed -i "s|PENDING_BASE_COMMIT|$base|g"  "$t/task.toml" "$t/pre_artifacts.sh"
sed -i "s|PENDING_IMAGE|$image|g"       "$t/task.toml" "$t/tests/Dockerfile" "$t/environment/Dockerfile"
python3 - "$t/tests/config.json" "$base" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1]); cfg = json.loads(p.read_text())
cfg["base_commit"] = sys.argv[2]
p.write_text(json.dumps(cfg, indent=1) + "\n")
PY

echo "=== remaining PENDING (want none) ==="
grep -rn 'PENDING' "$t" && { echo "STILL PENDING"; exit 1; } || echo "none"
echo "=== codename sweep (want none) ==="
grep -rn -i -e silver -e gitattributes "$t" && { echo "CODENAME HIT"; exit 1; } || echo "clean"
echo "=== filled ==="
grep -n 'repository_url\|base_commit_hash\|docker_image' "$t/task.toml"
grep -n '^FROM' "$t/tests/Dockerfile" "$t/environment/Dockerfile"
grep -n 'base_commit' "$t/tests/config.json"
