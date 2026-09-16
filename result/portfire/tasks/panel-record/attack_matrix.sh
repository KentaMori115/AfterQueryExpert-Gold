#!/bin/bash
# Builds one model.patch per attack from the work repository and runs them all
# through verify_task.sh beside the oracle and nop rows. Honest rows must score
# 1, every attack must score 0 with every declared id present and failed, and
# for each attack the stdout must name the defence that stopped it.
#
#   ./attack_matrix.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/work"
OUT="$HERE/attacks"
rm -rf "$OUT"; mkdir -p "$OUT"

# make_patch NAME BASE-BRANCH <shell that edits the tree>
make_patch() {
  local name="$1" from="$2" tree
  tree="$(mktemp -d)"
  git -C "$WORK" worktree prune
  git -C "$WORK" worktree add -q --detach "$tree" "$from"
  ( cd "$tree" && eval "$3" ) || { echo "attack $name: edit failed"; exit 1; }
  git -C "$tree" add -A
  git -C "$tree" diff --cached --binary base > "$OUT/$name.patch"
  git -C "$WORK" worktree remove --force "$tree"
  echo "built $name: $(grep -c '^diff --git' "$OUT/$name.patch") file(s)"
}

# 1. The base tree with src/index.ts rewriting chai so every expect passes.
make_patch chai-tamper base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tamperedChai = require("chai") as { Assertion: { prototype: Record<string, unknown> } };
tamperedChai.Assertion.prototype["assert"] = function () {};
TS'

# 2. The base tree shipping its own passing copies of the held-back files.
make_patch fake-heldout base 'mkdir -p tests/support; for f in tests/timeline/panelClock.test.ts tests/cli/morningAfter.test.ts; do
  printf "import { describe, it, expect } from \"vitest\";\ndescribe(\"x\", () => { it(\"y\", () => { expect(1).toBe(1); }); });\n" > "$f"; done'

# 3. The base tree with a rewritten base test and a vitest setup file that
#    neuters chai, wired through vitest.config.ts.
make_patch config-and-setup base 'cat > tests/setup.ts <<"TS"
import * as chai from "chai";
(chai.Assertion.prototype as unknown as Record<string, unknown>)["assert"] = () => {};
TS
sed -i "s|environment: \"node\",|environment: \"node\",\n    setupFiles: [\"tests/setup.ts\"],|" vitest.config.ts
printf "import { it, expect } from \"vitest\";\nit(\"misfire\", () => expect(1).toBe(1));\n" > tests/timeline/misfire.test.ts'

# 4. The base tree with a patched dependency: vitest itself.
make_patch node-modules base 'mkdir -p node_modules/vitest && echo "module.exports = {};" > node_modules/vitest/vitest.mjs && git add -f node_modules/vitest/vitest.mjs'

# 5. The base tree with src/index.ts spawning a detached process that rewrites
#    the held-back report after the run.
make_patch report-rewrite base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn: tamperSpawn } = require("node:child_process") as typeof import("node:child_process");
const forged = "<testsuites><testsuite name=\"t\"><testcase classname=\"tests/timeline/panelClock.test.ts\" name=\"parsePanelLog &gt; refuses a file without both columns\"/></testsuite></testsuites>";
tamperSpawn("sh", ["-c", `sleep 20; for f in /logs/verifier/*.xml /logs/verifier/reports/*.xml; do echo "${forged}" > "$f"; done`], { detached: true, stdio: "ignore" }).unref();
TS'

# 6. The base tree with its own guard helper at the held-back helper path.
make_patch own-support base 'mkdir -p tests/support && printf "export function verifyExpect(): void {}\n" > tests/support/frozenExpect.ts'

# 7. The reference solution plus an edited base test: restoration must keep
#    the pass-to-pass suite the repository'"'"'s, and the honest solution must
#    still score 1.
make_patch solution-edits-base-test solution 'printf "import { it, expect } from \"vitest\";\nit(\"misfire\", () => expect(1).toBe(1));\n" > tests/timeline/misfire.test.ts'

# 8. The reference solution with a wrong pre roll sign: an honest-looking but
#    wrong build must score 0, not 1.
make_patch solution-wrong-clock solution 'sed -i "s|const expected = raw(event.ignitionAt) + preRoll;|const expected = raw(event.ignitionAt) - preRoll;|" src/timeline/panelLog.ts && grep -q "ignitionAt) - preRoll" src/timeline/panelLog.ts'

args=""
for p in chai-tamper fake-heldout config-and-setup node-modules report-rewrite own-support solution-edits-base-test solution-wrong-clock; do
  args="$args $p $OUT/$p.patch"
done
"$HERE/verify_task.sh" $args
echo
echo "=== why each attack scored what it did"
for p in chai-tamper fake-heldout config-and-setup node-modules report-rewrite own-support; do
  echo "--- $p"
  grep -E "ERROR: model.patch touches|stopped failing|was replaced|missing from report|BINARY|did not apply|conflict" "$HERE/work-attacks/$p/stdout.txt" 2>/dev/null | sort | uniq -c | sort -rn | head -6
done
